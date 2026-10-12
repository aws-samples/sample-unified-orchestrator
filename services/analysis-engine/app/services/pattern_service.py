"""Pattern analysis service — bridges TransformationAnalyzer with API layer."""
from typing import List, Dict, Any, Optional
import logging
import time
import json
import hashlib
from datetime import datetime

from app.services.transformation_analyzer import TransformationAnalyzer
from app.orchestrators.pattern_orchestrator import PatternOrchestrator
from app.config import Config

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300  # 5 minutes


class PatternService:
    """Service for pattern analysis operations."""

    def __init__(self):
        self.analyzer = TransformationAnalyzer()
        self.orchestrator = PatternOrchestrator()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ts: Dict[str, float] = {}  # wave_id -> timestamp

        # Lazy S3 client initialization
        self._s3_client = None
        self.bucket_name = Config.S3_ARA_BUCKET
        self.notes_bucket_name = Config.S3_UNO_DP_BUCKET

        logger.info("PatternService initialized")

    @property
    def s3_client(self):
        """Lazy-load S3 client when needed."""
        if self._s3_client is None:
            self._s3_client = Config.get_boto3_client('s3')
        return self._s3_client

    def _is_cache_valid(self, wave_id: str) -> bool:
        """Check if cached result for wave_id is still within TTL."""
        ts = self._cache_ts.get(wave_id)
        if ts is None:
            return False
        return (time.time() - ts) < CACHE_TTL_SECONDS

    @staticmethod
    def generate_stable_pattern_id(
        wave_id: str,
        pattern_signature: str,
        migration_strategy: str,
        component_changes: List[Dict[str, str]]
    ) -> str:
        """
        Generate deterministic pattern ID based on pattern content.
        Same pattern content = same pattern_id across multiple analysis runs.

        Args:
            wave_id: Wave identifier
            pattern_signature: Unique signature of the pattern
            migration_strategy: Migration strategy (e.g., UPGRADE, REPLACE)
            component_changes: List of component changes with publisher, product, versions

        Returns:
            Stable pattern ID with PATTERN_ prefix
        """
        # Sort component changes for consistency
        sorted_changes = sorted(
            component_changes,
            key=lambda x: (
                x.get('publisher', ''),
                x.get('product', ''),
                x.get('current_version', ''),
                x.get('target_version', '')
            )
        )

        # Create hash input
        hash_input = {
            'wave_id': wave_id,
            'pattern_signature': pattern_signature,
            'migration_strategy': migration_strategy,
            'component_changes': sorted_changes
        }

        # Generate SHA256 hash
        hash_str = json.dumps(hash_input, sort_keys=True)
        hash_digest = hashlib.sha256(hash_str.encode()).hexdigest()

        # Return pattern ID with prefix (first 12 chars of hash)
        return f"PATTERN_{hash_digest[:12].upper()}"

    # ------------------------------------------------------------------ #
    #  Core operations
    # ------------------------------------------------------------------ #

    def discover_patterns(
        self,
        wave_id: str,
        applications: List[Dict[str, Any]],
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        """
        Run transformation analysis for a wave.

        Args:
            wave_id: Wave identifier
            applications: Raw DynamoDB items (must include pam_data)
            use_cache: Return cached result if available

        Returns:
            Full result dict from TransformationAnalyzer.aggregate_wave_transformations
        """
        if use_cache and wave_id in self._cache and self._is_cache_valid(wave_id):
            logger.info(f"Returning cached patterns for wave {wave_id}")
            return self._cache[wave_id]

        result = self.analyzer.aggregate_wave_transformations(wave_id, applications)
        self._cache[wave_id] = result
        self._cache_ts[wave_id] = time.time()

        count = len(result.get("transformations", []))
        logger.info(f"Discovered {count} patterns for wave {wave_id}")
        return result

    def get_pattern(self, pattern_id: str) -> Optional[Dict[str, Any]]:
        """Look up a single pattern by transformation_id across all cached waves."""
        for result in self._cache.values():
            for t in result.get("transformations", []):
                if t.get("transformation_id") == pattern_id:
                    return t
        return None

    def list_patterns(
        self,
        wave_id: Optional[str] = None,
        types: Optional[List[str]] = None,
        complexity_levels: Optional[List[str]] = None,
        search_term: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List patterns with optional filters across cached results."""
        all_patterns: List[Dict[str, Any]] = []

        if wave_id and wave_id in self._cache:
            all_patterns = self._cache[wave_id].get("transformations", [])
        else:
            for result in self._cache.values():
                all_patterns.extend(result.get("transformations", []))

        return TransformationAnalyzer.apply_filters(
            all_patterns,
            types=types,
            complexity_levels=complexity_levels,
            search_term=search_term,
        )

    def clear_cache(self, wave_id: Optional[str] = None):
        """Clear cached results."""
        if wave_id:
            self._cache.pop(wave_id, None)
            self._cache_ts.pop(wave_id, None)
        else:
            self._cache.clear()
            self._cache_ts.clear()

    # ------------------------------------------------------------------ #
    #  Wave Pattern Analysis (New - Independent from Risk Assessment)
    # ------------------------------------------------------------------ #

    def analyze_wave_patterns(self, wave_id: str, similarity_threshold: int = 70) -> Dict[str, Any]:
        """
        Run wave pattern analysis using PatternOrchestrator.

        This is independent from risk assessment and focuses on identifying
        migration patterns across applications in a wave.

        Filters applications by lifecycle status:
        - Includes only applications with risk_assessment_status = COMPLETED
        - Excludes applications with wave_analysis_status = COMPLETED
        - Excludes applications with atx_mapping_status = COMPLETED

        Args:
            wave_id: Wave ID to analyze
            similarity_threshold: Percentage threshold for grouping similar patterns (default: 70)

        Returns:
            Pattern analysis report with pattern groups, statistics, and exclusion info
        """
        logger.info(f"Starting wave pattern analysis for wave {wave_id} with {similarity_threshold}% similarity threshold")

        try:
            # Initialize status service for filtering
            from app.services.application_status_service import ApplicationStatusService
            from app.models.application import ApplicationStatus
            status_service = ApplicationStatusService()

            # Get eligible applications for wave analysis
            eligible_apps = status_service.get_applications_for_wave_analysis(wave_id)

            # Get all applications in wave for exclusion reporting
            all_apps = status_service.application_repo.get_by_wave(wave_id)

            # Calculate exclusion counts
            excluded_count = len(all_apps) - len(eligible_apps)
            exclusion_reasons = {
                'risk_not_started': 0,
                'wave_already_completed': 0,
                'atx_already_completed': 0
            }

            for app in all_apps:
                if app['application_id'] not in [a['application_id'] for a in eligible_apps]:
                    risk_status = app.get('risk_assessment_status')
                    if risk_status not in [ApplicationStatus.RISK_IN_PROGRESS, ApplicationStatus.RISK_COMPLETED]:
                        exclusion_reasons['risk_not_started'] += 1
                    elif app.get('wave_analysis_status') == ApplicationStatus.WAVE_COMPLETED:
                        exclusion_reasons['wave_already_completed'] += 1
                    elif app.get('atx_mapping_status') == ApplicationStatus.ATX_COMPLETED:
                        exclusion_reasons['atx_already_completed'] += 1

            if not eligible_apps:
                logger.warning(f"No eligible applications for wave analysis in wave {wave_id}")
                return {
                    'wave_id': wave_id,
                    'success': True,  # Changed to True since this is not an error
                    'message': 'No applications eligible for wave analysis',
                    'total_applications': len(all_apps),
                    'analyzed_count': 0,
                    'excluded_count': excluded_count,
                    'exclusion_reasons': exclusion_reasons,
                    'analysis_timestamp': datetime.now().isoformat()
                }

            # Set wave_analysis_status to IN_PROGRESS for eligible applications
            for app in eligible_apps:
                try:
                    status_service.update_wave_analysis_status(
                        app['application_id'],
                        ApplicationStatus.WAVE_IN_PROGRESS
                    )
                    logger.info(f"Set wave_analysis_status to IN_PROGRESS for {app['application_id']}")
                except Exception as e:
                    logger.warning(f"Could not update wave analysis status for {app['application_id']}: {e}")

            # Execute pattern orchestration workflow with eligible app IDs
            eligible_app_ids = [app['application_id'] for app in eligible_apps]
            result = self.orchestrator.execute(wave_id, similarity_threshold, eligible_app_ids)

            if result.get('error'):
                logger.error(f"Pattern analysis failed: {result['error']}")
                # Reset status to NOT_STARTED on failure
                for app in eligible_apps:
                    try:
                        status_service.update_wave_analysis_status(
                            app['application_id'],
                            ApplicationStatus.WAVE_NOT_STARTED
                        )
                    except Exception as e:
                        logger.warning(f"Could not reset wave analysis status for {app['application_id']}: {e}")
                return result

            # Mark risk assessment as COMPLETED and keep wave analysis as IN_PROGRESS
            # Wave analysis will be marked COMPLETED when ATX is assigned
            for app in eligible_apps:
                try:
                    # Mark risk assessment as COMPLETED
                    status_service.update_risk_assessment_status(
                        app['application_id'],
                        ApplicationStatus.RISK_COMPLETED
                    )
                    logger.info(f"Set risk_assessment_status to COMPLETED for {app['application_id']}")

                    # Keep wave_analysis_status as IN_PROGRESS (will be completed when ATX assigned)
                    logger.info(f"Wave analysis completed for {app['application_id']}, status remains IN_PROGRESS until ATX assigned")
                except Exception as e:
                    logger.warning(f"Could not update statuses for {app['application_id']}: {e}")

            # Add exclusion information to result
            result['total_applications'] = len(all_apps)
            result['analyzed_count'] = len(eligible_apps)
            result['excluded_count'] = excluded_count
            result['exclusion_reasons'] = exclusion_reasons

            # Save result to S3 with correct path: wave-analysis/{wave_id}/
            analysis_id = self._generate_analysis_id(wave_id)
            s3_key_json = f"wave-analysis/{wave_id}/{analysis_id}.json"
            s3_key_html = f"wave-analysis/{wave_id}/{analysis_id}.html"

            try:
                # Save JSON
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key_json,
                    Body=json.dumps(result, indent=2, default=str),
                    ContentType='application/json'
                )
                logger.info(f"Pattern analysis JSON saved to S3: {s3_key_json}")

                # Generate and save HTML
                html_content = self._generate_html_report(result)
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key_html,
                    Body=html_content,
                    ContentType='text/html'
                )
                logger.info(f"Pattern analysis HTML saved to S3: {s3_key_html}")

                result['s3_key'] = s3_key_json
                result['s3_key_html'] = s3_key_html
                result['analysis_id'] = analysis_id
            except Exception as e:
                logger.error(f"Failed to save pattern analysis to S3: {str(e)}")
                # Continue even if S3 save fails

            return result

        except Exception as e:
            logger.error(f"Error in wave pattern analysis: {str(e)}")
            import traceback
            traceback.print_exc()
            # Reset status on error
            try:
                from app.services.application_status_service import ApplicationStatusService
                from app.models.application import ApplicationStatus
                status_service = ApplicationStatusService()
                eligible_apps = status_service.get_applications_for_wave_analysis(wave_id)
                for app in eligible_apps:
                    try:
                        status_service.update_wave_analysis_status(
                            app['application_id'],
                            ApplicationStatus.WAVE_NOT_STARTED
                        )
                    except Exception as status_error:
                        logger.warning(f"Could not reset status for {app['application_id']}: {status_error}")
            except Exception as cleanup_error:
                logger.warning(f"Could not cleanup status on error: {cleanup_error}")

            return {
                'wave_id': wave_id,
                'error': str(e),
                'analysis_timestamp': datetime.now().isoformat()
            }

    def get_wave_pattern_analysis(self, wave_id: str, analysis_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve wave pattern analysis from S3.

        Args:
            wave_id: Wave ID
            analysis_id: Specific analysis ID (if None, gets latest)

        Returns:
            Pattern analysis report or None if not found
        """
        try:
            if analysis_id:
                # Get specific analysis
                s3_key = f"wave-analysis/{wave_id}/{analysis_id}.json"
            else:
                # Get latest analysis
                s3_key = self._get_latest_analysis_key(wave_id)
                if not s3_key:
                    logger.warning(f"No pattern analysis found for wave {wave_id}")
                    return None

            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            result = json.loads(response['Body'].read().decode('utf-8'))

            logger.info(f"Retrieved pattern analysis from S3: {s3_key}")
            return result

        except Exception as e:
            logger.error(f"Error retrieving pattern analysis: {str(e)}")
            return None

    def list_wave_pattern_analyses(self, wave_id: str) -> List[Dict[str, Any]]:
        """
        List all pattern analyses for a wave.

        Args:
            wave_id: Wave ID

        Returns:
            List of analysis metadata
        """
        try:
            prefix = f"wave-analysis/{wave_id}/"
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix
            )

            analyses = []
            for obj in response.get('Contents', []):
                key = obj['Key']

                # Skip HTML files - only list JSON analyses
                if key.endswith('.html'):
                    continue

                analysis_id = key.split('/')[-1].replace('.json', '')

                analyses.append({
                    'analysis_id': analysis_id,
                    'wave_id': wave_id,
                    's3_key': key,
                    'last_modified': obj['LastModified'].isoformat(),
                    'size': obj['Size']
                })

            # Sort by last modified (newest first)
            analyses.sort(key=lambda x: x['last_modified'], reverse=True)

            return analyses

        except Exception as e:
            logger.error(f"Error listing pattern analyses: {str(e)}")
            return []

    def _generate_analysis_id(self, wave_id: str) -> str:
        """Generate unique analysis ID."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f"{wave_id}_{timestamp}"

    def _get_latest_analysis_key(self, wave_id: str) -> Optional[str]:
        """Get S3 key for latest analysis."""
        analyses = self.list_wave_pattern_analyses(wave_id)
        if analyses:
            return analyses[0]['s3_key']
        return None

    def _generate_html_report(self, result: Dict[str, Any]) -> str:
        """
        Generate HTML report for wave pattern analysis.

        Args:
            result: Pattern analysis result dictionary

        Returns:
            HTML string
        """
        wave_id = result.get('wave_id', 'Unknown')
        exec_summary = result.get('executive_summary', {})
        patterns = result.get('patterns', [])
        recommendations = result.get('recommendations', [])
        timestamp = result.get('analysis_timestamp', datetime.now().isoformat())

        # Build HTML
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Pattern Analysis - {wave_id}</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }}
        .header h1 {{
            margin: 0 0 10px 0;
            font-size: 2.5em;
        }}
        .header .subtitle {{
            opacity: 0.9;
            font-size: 1.1em;
        }}
        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        .summary-card {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }}
        .summary-card .value {{
            font-size: 2.5em;
            font-weight: bold;
            color: #667eea;
            margin: 10px 0;
        }}
        .summary-card .label {{
            color: #666;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        .section {{
            background: white;
            padding: 25px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .section h2 {{
            color: #667eea;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
            margin-top: 0;
        }}
        .recommendations {{
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 4px;
        }}
        .recommendations ul {{
            margin: 10px 0;
            padding-left: 20px;
        }}
        .recommendations li {{
            margin: 8px 0;
        }}
        .pattern {{
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            background: #fafafa;
        }}
        .pattern-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }}
        .pattern-name {{
            font-size: 1.3em;
            font-weight: bold;
            color: #333;
        }}
        .pattern-id {{
            font-size: 0.85em;
            color: #666;
            font-family: monospace;
            background: #e0e0e0;
            padding: 4px 8px;
            border-radius: 4px;
        }}
        .badge {{
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: bold;
            margin-left: 10px;
        }}
        .badge-blue {{
            background: #2196F3;
            color: white;
        }}
        .badge-green {{
            background: #4CAF50;
            color: white;
        }}
        .badge-grey {{
            background: #9E9E9E;
            color: white;
        }}
        .pattern-description {{
            color: #555;
            margin: 15px 0;
            line-height: 1.8;
            padding: 15px;
            background: white;
            border-radius: 4px;
        }}
        .pattern-meta {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }}
        .meta-item {{
            background: white;
            padding: 10px;
            border-radius: 4px;
            border-left: 3px solid #667eea;
        }}
        .meta-label {{
            font-size: 0.85em;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .meta-value {{
            font-size: 1.2em;
            font-weight: bold;
            color: #333;
            margin-top: 5px;
        }}
        .applications {{
            margin-top: 15px;
        }}
        .app-item {{
            background: white;
            padding: 12px;
            margin: 8px 0;
            border-radius: 4px;
            border-left: 3px solid #764ba2;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        .app-name {{
            font-weight: 500;
        }}
        .app-id {{
            font-family: monospace;
            color: #666;
            font-size: 0.9em;
        }}
        .app-stats {{
            display: flex;
            gap: 15px;
            font-size: 0.9em;
        }}
        .app-stat {{
            color: #666;
        }}
        .footer {{
            text-align: center;
            color: #666;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e0e0e0;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }}
        th {{
            background: #f5f5f5;
            font-weight: 600;
            color: #667eea;
        }}
        tr:hover {{
            background: #f9f9f9;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Wave Pattern Analysis Report</h1>
        <div class="subtitle">
            Wave: {wave_id} | Generated: {datetime.fromisoformat(timestamp).strftime('%B %d, %Y at %I:%M %p')}
        </div>
    </div>

    <div class="summary">
        <div class="summary-card">
            <div class="label">Total Applications</div>
            <div class="value">{exec_summary.get('total_applications', 0)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Patterns Found</div>
            <div class="value">{exec_summary.get('unique_patterns', 0)}</div>
        </div>
        <div class="summary-card">
            <div class="label">With Changes</div>
            <div class="value">{exec_summary.get('applications_with_patterns', 0)}</div>
        </div>
        <div class="summary-card">
            <div class="label">Assessment Needed</div>
            <div class="value">{exec_summary.get('applications_without_patterns', 0)}</div>
        </div>
    </div>
"""

        # Recommendations
        if recommendations:
            html += """
    <div class="recommendations">
        <h3 style="margin-top: 0;">📋 Recommendations</h3>
        <ul>
"""
            for rec in recommendations:
                html += f"            <li>{rec}</li>\n"
            html += """        </ul>
    </div>
"""

        # Patterns
        html += """
    <div class="section">
        <h2>Migration Patterns</h2>
"""

        for pattern in patterns:
            pattern_state = pattern.get('pattern_state', '')
            badge_class = 'badge-blue' if pattern_state == 'HAS_CHANGES' else 'badge-green' if pattern_state == 'NO_CHANGES_NEEDED' else 'badge-grey'
            badge_text = 'Has Changes' if pattern_state == 'HAS_CHANGES' else 'No Changes' if pattern_state == 'NO_CHANGES_NEEDED' else 'Assessment Required'

            html += f"""
        <div class="pattern">
            <div class="pattern-header">
                <div>
                    <span class="pattern-name">{pattern.get('human_name', 'Unknown Pattern')}</span>
                    <span class="badge {badge_class}">{badge_text}</span>
                </div>
                <span class="pattern-id">{pattern.get('pattern_id', 'N/A')}</span>
            </div>
"""

            if pattern.get('description'):
                html += f"""
            <div class="pattern-description">
                {pattern.get('description')}
            </div>
"""

            html += f"""
            <div class="pattern-meta">
                <div class="meta-item">
                    <div class="meta-label">Applications</div>
                    <div class="meta-value">{pattern.get('application_count', 0)}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Migration Strategy</div>
                    <div class="meta-value">{pattern.get('migration_strategy', 'Unknown')}</div>
                </div>
            </div>
"""

            # Applications
            apps = pattern.get('applications', [])
            if apps:
                html += """
            <div class="applications">
                <h4>Applications:</h4>
"""
                for app in apps:
                    html += f"""
                <div class="app-item">
                    <div>
                        <span class="app-name">{app.get('app_name', 'Unknown')}</span>
                        <span class="app-id">({app.get('app_id', 'N/A')})</span>
                    </div>
                    <div class="app-stats">
                        <span class="app-stat">Changes: {app.get('change_count', 0)}</span>
                        <span class="app-stat">Components: {app.get('total_components', 0)}</span>
                    </div>
                </div>
"""
                html += """
            </div>
"""

            html += """
        </div>
"""

        html += """
    </div>

    <div class="footer">
        <p>Generated by Unified Orchestrator - Wave Pattern Analysis</p>
        <p style="font-size: 0.9em; color: #999;">This report provides migration pattern analysis for wave planning and execution.</p>
    </div>
</body>
</html>
"""

        return html

    def get_wave_pattern_analysis_html(self, wave_id: str, analysis_id: str) -> Optional[str]:
        """
        Retrieve HTML report for a wave pattern analysis from S3.
        If HTML doesn't exist, generate it from JSON data.

        Args:
            wave_id: Wave ID
            analysis_id: Analysis ID

        Returns:
            HTML content as string or None if not found
        """
        try:
            # First try to get existing HTML from S3
            s3_key = f"wave-analysis/{wave_id}/{analysis_id}.html"
            try:
                response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
                html_content = response['Body'].read().decode('utf-8')
                logger.info(f"Retrieved HTML report from S3: {s3_key}")
                return html_content
            except self.s3_client.exceptions.NoSuchKey:
                logger.info(f"HTML report not found in S3: {s3_key}, generating from JSON...")

                # HTML doesn't exist, try to generate from JSON
                json_data = self.get_wave_pattern_analysis_json(wave_id, analysis_id)
                if not json_data:
                    logger.warning(f"JSON data not found for {wave_id}/{analysis_id}")
                    return None

                # Generate HTML from JSON
                html_content = self._generate_html_report(json_data)

                # Save generated HTML to S3 for future use
                try:
                    self.s3_client.put_object(
                        Bucket=self.bucket_name,
                        Key=s3_key,
                        Body=html_content.encode('utf-8'),
                        ContentType='text/html'
                    )
                    logger.info(f"Generated and saved HTML report to S3: {s3_key}")
                except Exception as save_error:
                    logger.warning(f"Failed to save generated HTML to S3: {str(save_error)}")

                return html_content

        except Exception as e:
            logger.error(f"Error retrieving/generating HTML report: {str(e)}")
            return None

    def get_wave_pattern_analysis_json(self, wave_id: str, analysis_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve JSON report for a wave pattern analysis from S3.

        Args:
            wave_id: Wave ID
            analysis_id: Analysis ID

        Returns:
            JSON content as dictionary or None if not found
        """
        try:
            s3_key = f"wave-analysis/{wave_id}/{analysis_id}.json"
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            json_content = json.loads(response['Body'].read().decode('utf-8'))

            logger.info(f"Retrieved JSON report from S3: {s3_key}")
            return json_content

        except self.s3_client.exceptions.NoSuchKey:
            logger.warning(f"JSON report not found: {s3_key}")
            return None
        except Exception as e:
            logger.error(f"Error retrieving JSON report: {str(e)}")
            return None

    # ------------------------------------------------------------------ #
    #  ATX Transformation Operations
    # ------------------------------------------------------------------ #

    def get_atx_transformations(self) -> Dict[str, Any]:
        """
        Fetch ATX transformation definitions from S3.

        Returns:
            Dictionary with success status and transformations list
        """
        try:
            # List all files in notes/atx/ prefix (where notes service uploads them)
            # ATX files are in UNO's notes bucket, not ARA's assets bucket
            notes_bucket = self.notes_bucket_name or self.bucket_name
            response = self.s3_client.list_objects_v2(
                Bucket=notes_bucket,
                Prefix='notes/atx/'
            )

            if 'Contents' not in response or len(response['Contents']) == 0:
                logger.warning("No ATX files found in S3 under notes/atx/")
                return {
                    'success': False,
                    'error': 'No ATX file uploaded. Please upload an ATX file first.',
                    'transformations': []
                }

            # Get the most recent ATX file (by LastModified)
            atx_files = [obj for obj in response['Contents'] if obj['Key'].endswith('.json')]

            if not atx_files:
                logger.warning("No JSON files found in notes/atx/ prefix")
                return {
                    'success': False,
                    'error': 'No valid ATX JSON file found.',
                    'transformations': []
                }

            # Sort by LastModified descending and get the latest
            latest_file = sorted(atx_files, key=lambda x: x['LastModified'], reverse=True)[0]
            s3_key = latest_file['Key']

            logger.info(f"Fetching ATX file from S3: {s3_key}")

            # Fetch the file content
            obj_response = self.s3_client.get_object(Bucket=notes_bucket, Key=s3_key)
            content = obj_response['Body'].read().decode('utf-8')
            atx_data = json.loads(content)

            # Extract transformations
            transformations = atx_data.get('transformations', [])

            logger.info(f"Successfully loaded {len(transformations)} ATX transformations")

            return {
                'success': True,
                'transformations': transformations,
                'file_key': s3_key,
                'last_modified': latest_file['LastModified'].isoformat()
            }

        except Exception as e:
            logger.error(f"Error fetching ATX transformations: {str(e)}")
            return {
                'success': False,
                'error': f'Failed to fetch ATX transformations: {str(e)}',
                'transformations': []
            }

    def submit_atx_mappings(self, wave_id: str, mappings: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Submit ATX mappings for patterns in a wave.

        Updates atx_mapping_status to MAPPED for each application.

        Args:
            wave_id: Wave ID
            mappings: List of mapping dictionaries with:
                - pattern_id
                - application_id
                - application_name
                - strategy
                - transformation_instructions
                - atx_name
                - atx_description

        Returns:
            Dictionary with success status, results, and status transitions
        """
        try:
            if not mappings:
                return {
                    'success': False,
                    'error': 'No mappings provided'
                }

            # Validate ATX names against uploaded file
            atx_result = self.get_atx_transformations()
            if not atx_result['success']:
                return {
                    'success': False,
                    'error': 'Cannot validate ATX names: ' + atx_result.get('error', 'Unknown error')
                }

            valid_atx_names = {t['name'] for t in atx_result['transformations']}

            # Validate all mappings
            for mapping in mappings:
                atx_name = mapping.get('atx_name')
                if atx_name and atx_name not in valid_atx_names:
                    return {
                        'success': False,
                        'error': f'Invalid ATX name: {atx_name}. Not found in uploaded ATX file.'
                    }

            # Initialize status service
            from app.services.application_status_service import ApplicationStatusService
            from app.models.application import ApplicationStatus
            status_service = ApplicationStatusService()

            # Get DynamoDB table
            dynamodb = Config.get_boto3_resource('dynamodb')
            table_name = Config.PATTERNS_TABLE
            table = dynamodb.Table(table_name)

            # Update each mapping in DynamoDB
            updated_count = 0
            errors = []
            status_transitions = []

            for mapping in mappings:
                try:
                    pattern_id = mapping.get('pattern_id')
                    application_id = mapping.get('application_id')

                    if not pattern_id or not application_id:
                        errors.append(f"Missing pattern_id or application_id in mapping")
                        continue

                    # Create composite key for the pattern-application mapping
                    # Using pattern_id as partition key and application_id as sort key
                    item = {
                        'pattern_id': pattern_id,
                        'application_id': application_id,
                        'wave_id': wave_id,
                        'application_name': mapping.get('application_name'),
                        'strategy': mapping.get('strategy'),
                        'transformation_instructions': mapping.get('transformation_instructions'),
                        'atx_name': mapping.get('atx_name'),
                        'atx_description': mapping.get('atx_description'),
                        'updated_at': int(datetime.now().timestamp())
                    }

                    # Put item to DynamoDB
                    table.put_item(Item=item)
                    updated_count += 1

                    # Update atx_mapping_status to MAPPED and wave_analysis_status to COMPLETED
                    try:
                        old_atx_status = status_service.application_repo.get(application_id).get('atx_mapping_status', ApplicationStatus.ATX_NOT_MAPPED)

                        # Mark ATX as MAPPED
                        status_service.update_atx_mapping_status(
                            application_id,
                            ApplicationStatus.ATX_MAPPED
                        )
                        status_transitions.append({
                            'application_id': application_id,
                            'old_status': old_atx_status,
                            'new_status': ApplicationStatus.ATX_MAPPED
                        })
                        logger.info(f"Set atx_mapping_status to MAPPED for {application_id}")

                        # Mark wave analysis as COMPLETED (since ATX is now assigned)
                        status_service.update_wave_analysis_status(
                            application_id,
                            ApplicationStatus.WAVE_COMPLETED
                        )
                        logger.info(f"Set wave_analysis_status to COMPLETED for {application_id} (ATX assigned)")

                    except Exception as e:
                        logger.warning(f"Could not update ATX mapping status for {application_id}: {e}")

                    logger.info(f"Updated ATX mapping for pattern {pattern_id}, app {application_id}")

                except Exception as e:
                    error_msg = f"Failed to update pattern {mapping.get('pattern_id')}: {str(e)}"
                    logger.error(error_msg)
                    errors.append(error_msg)

            if errors:
                return {
                    'success': updated_count > 0,
                    'updated_count': updated_count,
                    'status_transitions': status_transitions,
                    'errors': errors,
                    'message': f'Partially completed: {updated_count} mappings updated, {len(errors)} failed'
                }

            return {
                'success': True,
                'updated_count': updated_count,
                'status_transitions': status_transitions,
                'message': f'Successfully updated {updated_count} ATX mappings'
            }

        except Exception as e:
            logger.error(f"Error submitting ATX mappings: {str(e)}")
            return {
                'success': False,
                'error': f'Failed to submit ATX mappings: {str(e)}'
            }

    def get_atx_mappings(self, wave_id: str, include_all: bool = False) -> Dict[str, Any]:
        """
        Get existing ATX mappings for a wave.

        Args:
            wave_id: Wave ID
            include_all: If True, returns all ATX mappings regardless of status.
                        If False, filters by lifecycle status (wave_analysis_status = COMPLETED, atx_mapping_status != COMPLETED)

        Returns:
            Dictionary with success status and mappings list
        """
        try:
            eligible_app_ids = None

            if not include_all:
                # Initialize status service for filtering
                from app.services.application_status_service import ApplicationStatusService
                from app.models.application import ApplicationStatus
                status_service = ApplicationStatusService()

                # Get eligible applications for ATX mapping
                eligible_apps = status_service.get_applications_for_atx_mapping(wave_id)
                eligible_app_ids = {app['application_id'] for app in eligible_apps}

            # Get DynamoDB table
            dynamodb = Config.get_boto3_resource('dynamodb')
            table_name = Config.PATTERNS_TABLE
            table = dynamodb.Table(table_name)

            # Query by wave_id using GSI
            from boto3.dynamodb.conditions import Key

            response = table.query(
                IndexName='wave_id_index',
                KeyConditionExpression=Key('wave_id').eq(wave_id)
            )

            items = response.get('Items', [])

            # Filter items that have ATX mappings (atx_name is not None/empty)
            # If include_all is False, also filter by eligible applications
            mappings = []
            for item in items:
                application_id = item.get('application_id')
                atx_name = item.get('atx_name')

                # Skip if no ATX mapping
                if not atx_name:
                    continue

                # If filtering by status, check if application is eligible
                if eligible_app_ids is not None and application_id not in eligible_app_ids:
                    continue

                mappings.append({
                    'pattern_id': item.get('pattern_id'),
                    'application_id': application_id,
                    'application_name': item.get('application_name'),
                    'atx_name': atx_name,
                    'atx_description': item.get('atx_description'),
                    'strategy': item.get('strategy'),
                    'transformation_instructions': item.get('transformation_instructions'),
                    'updated_at': item.get('updated_at')
                })

            filter_msg = "all" if include_all else "filtered by status"
            logger.info(f"Retrieved {len(mappings)} ATX mappings for wave {wave_id} ({filter_msg})")

            return {
                'success': True,
                'wave_id': wave_id,
                'mappings': mappings,
                'count': len(mappings)
            }

        except Exception as e:
            logger.error(f"Error getting ATX mappings for wave {wave_id}: {str(e)}")
            return {
                'success': False,
                'error': f'Failed to get ATX mappings: {str(e)}'
            }
