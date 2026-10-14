"""
Pattern Orchestrator Service

Orchestrates the wave pattern analysis workflow with:
1. Sequential execution of pattern analysis nodes
2. Simplified pattern grouping without complex aggregation
"""

import logging
from typing import Dict, Any, List
from datetime import datetime
import time
from collections import defaultdict

logger = logging.getLogger(__name__)


class PatternOrchestrator:
    """
    Orchestrator for wave pattern analysis workflow.

    Simplified Workflow:
    1. retrieve_reports_for_wave -> Fetch all assessment reports from S3
    2. run_wave_analysis -> Identify patterns from version changes
    3. Group applications by pattern_id
    """

    def __init__(self):
        """Initialize the orchestrator."""
        self.results = {}

    def execute(self, wave_id: str, similarity_threshold: int = 70, eligible_app_ids: List[str] = None) -> Dict[str, Any]:
        """
        Execute the pattern analysis workflow.

        Args:
            wave_id: Wave ID to analyze
            similarity_threshold: Percentage threshold for grouping similar patterns (default: 70)
            eligible_app_ids: List of application IDs eligible for analysis (optional, filters results)

        Returns:
            Comprehensive pattern analysis report
        """
        start_time = time.time()
        logger.info(f"Starting pattern orchestration for wave {wave_id} with {similarity_threshold}% similarity threshold")

        try:
            # Node 1: Retrieve reports from S3
            logger.info("Executing retrieve_reports_for_wave node...")
            retriever_start = time.time()
            retriever_result = self._execute_retrieve_reports(wave_id, eligible_app_ids)
            retriever_time = time.time() - retriever_start
            logger.info(f"Retrieve reports completed in {retriever_time:.2f}s")
            self.results['retrieve_reports'] = retriever_result

            if retriever_result.get('error'):
                logger.error(f"Retrieve reports failed: {retriever_result['error']}")
                return self._create_error_response(wave_id, "Failed to retrieve reports")

            # Node 2: Run wave analysis
            logger.info("Executing run_wave_analysis node...")
            analysis_start = time.time()
            analysis_result = self._execute_wave_analysis(retriever_result, similarity_threshold)
            analysis_time = time.time() - analysis_start
            logger.info(f"Wave analysis completed in {analysis_time:.2f}s")
            self.results['wave_analysis'] = analysis_result

            if analysis_result.get('error') and not analysis_result.get('patterns_ready_for_grouping'):
                logger.error(f"Wave analysis failed: {analysis_result['error']}")
                return self._create_error_response(wave_id, "Failed to analyze patterns")

            total_time = time.time() - start_time
            logger.info(f"✓ Pattern orchestration complete in {total_time:.2f}s")
            logger.info(f"  Breakdown: retrieve={retriever_time:.2f}s, analysis={analysis_time:.2f}s")

            # Build final report
            final_result = self._build_final_report(
                wave_id,
                retriever_result,
                analysis_result,
                {
                    'total_time': total_time,
                    'retriever_time': retriever_time,
                    'analysis_time': analysis_time
                }
            )

            return final_result

        except Exception as e:
            logger.error(f"Error in pattern orchestration: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._create_error_response(wave_id, str(e))

    def _execute_retrieve_reports(self, wave_id: str, eligible_app_ids: List[str] = None) -> Dict[str, Any]:
        """Execute retrieve reports tool."""
        from app.strands.tools.patterns.retrieve_reports_for_wave import retrieve_reports_for_wave
        return retrieve_reports_for_wave(wave_id, eligible_app_ids)

    def _execute_wave_analysis(self, retriever_result: Dict[str, Any], similarity_threshold: int) -> Dict[str, Any]:
        """Execute wave analysis tool with similarity threshold."""
        from app.strands.tools.patterns.run_wave_analysis import run_wave_analysis
        return run_wave_analysis(retriever_result, similarity_threshold)

    def _build_final_report(
        self,
        wave_id: str,
        retriever_result: Dict[str, Any],
        analysis_result: Dict[str, Any],
        performance_metrics: Dict[str, float]
    ) -> Dict[str, Any]:
        """Build final pattern analysis report with simplified grouping."""

        # Extract application patterns
        application_patterns = analysis_result.get('application_patterns', [])

        # Save patterns to DynamoDB for reuse in future analyses
        self._save_patterns_to_dynamodb(wave_id, application_patterns)

        # Group applications by pattern_id
        pattern_groups = defaultdict(list)
        for app_pattern in application_patterns:
            pattern_id = app_pattern.get('pattern_id')
            pattern_groups[pattern_id].append(app_pattern)

        # Build pattern summary
        patterns = []
        for pattern_id, apps in pattern_groups.items():
            first_app = apps[0]
            patterns.append({
                'pattern_id': pattern_id,
                'pattern_state': first_app.get('pattern_state'),
                'human_name': first_app.get('human_name'),
                'description': first_app.get('description'),
                'pattern_signature': first_app.get('pattern_signature'),
                'migration_strategy': first_app.get('migration_strategy'),
                'application_count': len(apps),
                'applications': [
                    {
                        'app_id': app.get('app_id'),
                        'app_name': app.get('app_name'),
                        'description': app.get('description'),
                        'change_count': app.get('change_count', 0),
                        'total_components': app.get('total_components', 0),
                        'pattern_reused': app.get('pattern_reused', False),
                        'matched_from_app': app.get('matched_from_app'),
                        'atx_name': app.get('atx_name'),
                        'atx_mapped': app.get('atx_mapped', False)
                    }
                    for app in apps
                ]
            })

        # Calculate statistics
        total_applications = len(application_patterns)
        apps_with_changes = len([a for a in application_patterns if a.get('pattern_state') == 'HAS_CHANGES'])
        apps_no_changes = len([a for a in application_patterns if a.get('pattern_state') == 'NO_CHANGES_NEEDED'])
        apps_no_targets = len([a for a in application_patterns if a.get('pattern_state') == 'NO_TARGET_VERSIONS'])
        unique_patterns = len([p for p in patterns if p['pattern_id'].startswith('PATTERN_')])
        patterns_reused = len([a for a in application_patterns if a.get('pattern_reused')])

        statistics = {
            'total_applications': total_applications,
            'applications_with_patterns': apps_with_changes,
            'applications_no_changes': apps_no_changes,
            'applications_no_targets': apps_no_targets,
            'unique_patterns': unique_patterns,
            'total_pattern_groups': len(patterns),
            'patterns_reused': patterns_reused,
            'similarity_threshold': analysis_result.get('similarity_threshold', 70)
        }

        # Build executive summary
        executive_summary = {
            'wave_id': wave_id,
            'total_applications': total_applications,
            'applications_analyzed': total_applications,
            'unique_patterns': unique_patterns,
            'applications_with_patterns': apps_with_changes,
            'applications_without_patterns': apps_no_targets,
            'applications_no_migration_needed': apps_no_changes,
            'analysis_timestamp': datetime.now().isoformat()
        }

        # Generate recommendations
        recommendations = self._generate_recommendations(patterns, statistics)

        return {
            'wave_id': wave_id,
            'analysis_timestamp': datetime.now().isoformat(),
            'executive_summary': executive_summary,
            'patterns': patterns,
            'statistics': statistics,
            'recommendations': recommendations,
            'performance_metrics': performance_metrics
        }

    def _generate_recommendations(self, patterns: list, statistics: Dict[str, Any]) -> list:
        """Generate recommendations based on pattern analysis."""
        recommendations = []

        if not patterns:
            recommendations.append("No patterns identified. Ensure applications have assessment reports with target versions.")
            return recommendations

        # Pattern reuse information
        patterns_reused = statistics.get('patterns_reused', 0)
        if patterns_reused > 0:
            similarity_threshold = statistics.get('similarity_threshold', 70)
            recommendations.append(
                f"✓ Pattern reuse enabled: {patterns_reused} application(s) reused existing patterns "
                f"(similarity threshold: {similarity_threshold}%). This accelerates migration planning by "
                f"leveraging previously identified transformation patterns."
            )

        # Find patterns with multiple applications (batch migration opportunity)
        batch_patterns = [p for p in patterns if p['application_count'] > 1 and p['pattern_id'].startswith('PATTERN_')]
        if batch_patterns:
            total_batch_apps = sum(p['application_count'] for p in batch_patterns)
            recommendations.append(
                f"{len(batch_patterns)} patterns affect multiple applications ({total_batch_apps} total). "
                f"These can be migrated together in batches."
            )

        # Find largest pattern
        migration_patterns = [p for p in patterns if p['pattern_id'].startswith('PATTERN_')]
        if migration_patterns:
            largest_pattern = max(migration_patterns, key=lambda x: x['application_count'])
            recommendations.append(
                f"Largest pattern '{largest_pattern['human_name']}' affects {largest_pattern['application_count']} applications. "
                f"Prioritize this pattern for migration planning."
            )

        # Check for applications without patterns
        no_targets = statistics.get('applications_no_targets', 0)
        if no_targets > 0:
            total = statistics.get('total_applications', 1)
            percentage = round((no_targets / total * 100), 1)
            recommendations.append(
                f"{no_targets} applications ({percentage}%) have no target versions defined. "
                f"Complete risk assessments for these applications."
            )

        # Check for applications with no changes needed
        no_changes = statistics.get('applications_no_changes', 0)
        if no_changes > 0:
            recommendations.append(
                f"{no_changes} applications are already at target versions and require no migration."
            )

        return recommendations

    def _create_error_response(self, wave_id: str, error_message: str) -> Dict[str, Any]:
        """Create error response."""
        return {
            'wave_id': wave_id,
            'error': error_message,
            'analysis_timestamp': datetime.now().isoformat(),
            'executive_summary': {},
            'patterns': [],
            'statistics': {},
            'recommendations': []
        }

    def _save_patterns_to_dynamodb(self, wave_id: str, application_patterns: List[Dict[str, Any]]) -> None:
        """
        Save patterns to wave_patterns DynamoDB table for reuse in future analyses.

        This enables pattern reuse across applications with similar component transformations.
        Only saves patterns with HAS_CHANGES state (actual migration patterns).

        Args:
            wave_id: Wave identifier
            application_patterns: List of application pattern dictionaries
        """
        try:
            from app.config import Config

            # Get DynamoDB table
            dynamodb = Config.get_boto3_resource('dynamodb')
            table_name = Config.PATTERNS_TABLE
            table = dynamodb.Table(table_name)

            saved_count = 0
            skipped_count = 0

            for app_pattern in application_patterns:
                pattern_id = app_pattern.get('pattern_id')
                pattern_state = app_pattern.get('pattern_state')
                app_id = app_pattern.get('app_id')

                # Only save patterns with actual changes (skip NO_PATTERN_REQ, NO_PATTERN_IDENTIFIED, ERROR)
                if pattern_state != 'HAS_CHANGES':
                    skipped_count += 1
                    continue

                # Check if this is a reused pattern - don't save duplicates
                if app_pattern.get('pattern_reused'):
                    logger.info(f"Skipping save for app {app_id} - pattern {pattern_id} was reused")
                    skipped_count += 1
                    continue

                # Create item for DynamoDB
                item = {
                    'pattern_id': pattern_id,
                    'application_id': app_id,
                    'wave_id': wave_id,
                    'application_name': app_pattern.get('app_name'),
                    'strategy': app_pattern.get('migration_strategy'),
                    'transformation_instructions': app_pattern.get('pattern_signature'),  # Save signature for matching
                    'human_name': app_pattern.get('human_name'),
                    'description': app_pattern.get('description'),
                    'atx_name': app_pattern.get('atx_name'),  # Will be None initially, updated when ATX assigned
                    'atx_description': None,
                    'updated_at': int(datetime.now().timestamp())
                }

                # Save to DynamoDB
                table.put_item(Item=item)
                saved_count += 1
                logger.info(f"Saved pattern {pattern_id} for app {app_id} to wave_patterns table")

            logger.info(f"Saved {saved_count} patterns to DynamoDB, skipped {skipped_count}")

        except Exception as e:
            logger.error(f"Error saving patterns to DynamoDB: {str(e)}")
            import traceback
            traceback.print_exc()
            # Don't fail the entire analysis if DynamoDB save fails
