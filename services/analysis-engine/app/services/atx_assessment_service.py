"""ATX Assessment Service — extracts structured data from ATXDocumentation using AI."""
import json
import os
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

import boto3
from app.config import Config

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """Analyze the following ATXDocumentation content from a codebase analysis and extract structured JSON for migration engineers.

Focus on the most important information: summary, architecture, dependencies, security risks, technical debt, breaking changes, and diagrams. Be thorough but concise.

Extract the following sections as JSON:

1. **summary**: 3-5 sentence executive summary covering key findings, risks, and recommendations

2. **system_overview**: Object with: description, architecture_style, deployment_model, technology_stack (object with languages, frameworks, build_tools, servers, databases), aws_recommendation (string — recommended AWS migration strategy)

3. **current_state**: Object with: languages (list), frameworks (list), build_tools (list), servers (list), runtime_deps (list), infrastructure (list of AWS services/IaC tools), databases (list), deployment_model (string)

4. **target_state**: Object with: recommended_versions (list of {component, from_version, to_version}), transformation_type (string), migration_path (string)

5. **dependencies**: List of dependencies with: name, version, latest_version, health (critical/outdated/current), category (maven/npm/build/aws/infrastructure)

6. **breaking_changes**: List of breaking changes with: change, impact, affected_files (list), remediation, severity (critical/high/medium/low)

7. **security**: Object with: iam_violations_count, credential_issues (list), network_gaps (list), vulnerabilities_by_severity (list of {severity, count}), eol_component_count

8. **technical_debt**: Object with critical/high/medium/low arrays, each item having: item, component, category, remediation

9. **outdated_components**: List of outdated items with: name, current_version, latest_version, severity, remediation

10. **complexity**: Object with: overall_rating, cyclomatic_complexity_avg, coupling_level, code_lines

11. **migration_plan**: Ordered list of phases with: phase_name, items (count), priority, dependencies (list), estimated_effort

12. **component_order**: Ordered list of components for migration with: name, order, reason, dependencies (list)

13. **test_specifications**: List of test specs with: name, type (unit/integration/e2e), description, expected_result

14. **validation_criteria**: List of criteria with: name, description, acceptance_condition, priority

15. **remediation_plan**: Ordered list of remediation items with: item, priority, effort, description, dependencies (list)

16. **component_inventory**: List of components with: name, type (Application/Infrastructure/Build), source_file, language, description

17. **data_stores**: List of databases/storage with: type, technology, purpose, migration_impact

18. **diagrams**: List of ALL mermaid diagram code strings found in the content. Each must be valid Mermaid v11 syntax starting with a diagram type keyword (e.g. graph TD, flowchart LR, sequenceDiagram). Do NOT wrap in markdown code fences. Use quoted labels for nodes containing special characters like parentheses: A["My Label (v2)"]

Output valid JSON only, no markdown wrapping:
"""


class ATXAssessmentService:
    """Extracts structured assessment data from ATXDocumentation and stores in DynamoDB."""

    def __init__(self):
        self.table_name = Config.ATX_ASSESSMENTS_TABLE
        self.s3_bucket = Config.S3_ARA_BUCKET
        self.model_id = Config.BEDROCK_MODEL_ID

    def _read_s3_files(self, s3_prefix: str) -> str:
        """Read all markdown files from an S3 prefix and concatenate."""
        s3 = Config.get_boto3_client('s3')
        content_parts = []
        try:
            paginator = s3.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=self.s3_bucket, Prefix=s3_prefix):
                for obj in page.get('Contents', []):
                    if obj['Key'].endswith('.md'):
                        try:
                            resp = s3.get_object(Bucket=self.s3_bucket, Key=obj['Key'])
                            text = resp['Body'].read().decode('utf-8')
                            filename = obj['Key'].split('/')[-1]
                            content_parts.append(f"--- FILE: {filename} ---\n{text}")
                        except Exception as e:
                            logger.warning(f"Failed to read {obj['Key']}: {e}")
        except Exception as e:
            logger.error(f"Failed to list S3 prefix {s3_prefix}: {e}")
        return '\n\n'.join(content_parts)

    def _extract_with_ai(self, content: str) -> Dict[str, Any]:
        """Use Bedrock to extract structured data from ATXDocumentation content."""
        if not self.model_id:
            logger.warning("BEDROCK_MODEL_ID not set, returning empty extraction")
            return {}

        # Truncate if too long (Nova lite has ~300k context)
        if len(content) > 200000:
            content = content[:200000] + "\n\n[TRUNCATED]"

        prompt = EXTRACTION_PROMPT + content
        bedrock = Config.get_boto3_client('bedrock-runtime')

        try:
            request_body = {
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"maxTokens": 10240, "temperature": 0.1}
            }
            response = bedrock.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json"
            )
            resp_body = json.loads(response['body'].read())

            # Nova format
            if 'output' in resp_body:
                ai_text = resp_body['output']['message']['content'][0]['text'].strip()
            else:
                ai_text = resp_body.get('content', [{}])[0].get('text', '').strip()

            # Parse JSON from response
            import re
            json_match = re.search(r'```json\s*(.*?)\s*```', ai_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            # Try direct parse
            return json.loads(ai_text)
        except json.JSONDecodeError as e:
            logger.error(f"AI returned invalid JSON: {e}")
            return {'error': 'AI returned invalid JSON', 'raw': ai_text[:500] if 'ai_text' in dir() else ''}
        except Exception as e:
            logger.error(f"AI extraction failed: {e}", exc_info=True)
            return {'error': str(e)}

    def _store_assessment(self, app_id: str, run_id: str, repo_name: str, data: Dict[str, Any]) -> None:
        """Store extracted assessment in DynamoDB."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.table_name)
        assessment_id = f'{run_id}#{repo_name}'
        item = {
            'application_id': app_id,
            'repo_run_key': f'{run_id}#{repo_name}',
            'run_id': run_id,
            'repo_name': repo_name,
            'assessed_at': datetime.now().isoformat(),
            'summary': data.get('summary', ''),
        }
        # Store all extracted fields as JSON strings
        json_store_fields = [
            'system_overview', 'current_state', 'target_state', 'dependencies',
            'breaking_changes', 'security', 'technical_debt', 'outdated_components',
            'complexity', 'migration_plan', 'component_order', 'test_specifications',
            'validation_criteria', 'remediation_plan', 'component_inventory',
            'data_stores', 'diagrams',
        ]
        for fld in json_store_fields:
            val = data.get(fld)
            if val is not None:
                item[fld] = json.dumps(val) if not isinstance(val, str) else val
        table.put_item(Item=item)
        logger.info(f"Stored ATX assessment for {app_id}/{repo_name} (run: {run_id})")

    def process_atx_results(self, app_id: str, run_id: str, repo_name: str, s3_prefix: str) -> Dict[str, Any]:
        """Full pipeline: read S3 -> AI extract -> store in DynamoDB."""
        logger.info(f"Processing ATX assessment for {app_id}/{repo_name} from {s3_prefix}")

        # Try ATXDocumentation subfolder first, then prefix directly (old format)
        prefix = s3_prefix if s3_prefix.endswith('/') else s3_prefix + '/'
        content = self._read_s3_files(prefix + 'ATXDocumentation/')
        if not content:
            content = self._read_s3_files(prefix)

        if not content:
            logger.warning(f"No markdown content found at {s3_prefix}")
            return {'success': False, 'error': 'No ATXDocumentation content found'}

        logger.info(f"Read {len(content)} chars for {repo_name}")

        data = self._extract_with_ai(content)
        if 'error' in data and not data.get('current_state'):
            return {'success': False, 'error': data['error']}

        self._store_assessment(app_id, run_id, repo_name, data)
        return {'success': True, 'app_id': app_id, 'repo_name': repo_name, 'sections': list(data.keys())}

    # ── Combined phased analysis methods ───────────────────────

    def process_combined_results(
        self,
        app_id: str,
        run_id: str,
        repo_s3_prefixes: Dict[str, str],
        dependency_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Aggregate assessment data across all repos from a combined phased analysis.

        Args:
            app_id: Application identifier.
            run_id: Unique run identifier.
            repo_s3_prefixes: Mapping of repo_name → S3 prefix where ATXDocumentation lives.
            dependency_data: Dict with keys: dependency_graph, execution_order,
                mermaid_diagram, repo_summaries.

        Returns:
            Dict with success status and summary of stored assessment.
        """
        execution_order: List[str] = dependency_data.get('execution_order', [])
        dependency_graph: Dict[str, List[str]] = dependency_data.get('dependency_graph', {})
        mermaid_diagram: str = dependency_data.get('mermaid_diagram', '')
        repo_summaries: Dict[str, str] = dependency_data.get('repo_summaries', {})

        logger.info(
            f"Processing combined assessment for {app_id} "
            f"({len(repo_s3_prefixes)} repos, run: {run_id})"
        )

        # Step 1: Extract per-repo assessments
        per_repo_assessments: List[Dict[str, Any]] = []
        for repo_name in execution_order:
            s3_prefix = repo_s3_prefixes.get(repo_name)
            if not s3_prefix:
                logger.warning(f"No S3 prefix for {repo_name}, skipping")
                per_repo_assessments.append({
                    'repo_name': repo_name,
                    'error': 'No S3 prefix available',
                })
                continue

            prefix = s3_prefix if s3_prefix.endswith('/') else f"{s3_prefix}/"
            content = self._read_s3_files(f"{prefix}ATXDocumentation/")
            if not content:
                content = self._read_s3_files(prefix)

            if not content:
                logger.warning(f"No content found for {repo_name} at {s3_prefix}")
                per_repo_assessments.append({
                    'repo_name': repo_name,
                    'error': 'No ATXDocumentation content found',
                })
                continue

            logger.info(f"Read {len(content)} chars for {repo_name}")
            data = self._extract_with_ai(content)
            data['repo_name'] = repo_name
            per_repo_assessments.append(data)

        # Step 2: Aggregate across repos
        aggregated = self._aggregate_assessments(per_repo_assessments)

        # Step 3: Build dependency_analysis section
        repo_roles = self._infer_repo_roles(per_repo_assessments, repo_summaries)
        dependency_analysis: Dict[str, Any] = {
            'dependency_graph': dependency_graph,
            'execution_order': execution_order,
            'mermaid_diagram': mermaid_diagram,
            'repo_roles': repo_roles,
        }

        # Step 4: Generate unified migration plan respecting dependency order
        migration_plan = self._build_ordered_migration_plan(
            per_repo_assessments, execution_order, repo_roles,
        )

        # Step 5: Assemble combined assessment
        combined_data: Dict[str, Any] = {
            'repo_name': 'combined-phased',
            'repos': per_repo_assessments,
            'dependency_analysis': dependency_analysis,
            'aggregated': aggregated,
            'migration_plan': migration_plan,
            'summary': self._build_combined_summary(
                per_repo_assessments, execution_order, aggregated,
            ),
        }

        # Step 6: Store in DynamoDB
        self._store_combined_assessment(app_id, run_id, combined_data)

        return {
            'success': True,
            'app_id': app_id,
            'repo_name': 'combined-phased',
            'repos_processed': len([r for r in per_repo_assessments if 'error' not in r]),
            'repos_failed': len([r for r in per_repo_assessments if 'error' in r]),
            'sections': list(combined_data.keys()),
        }

    def _aggregate_assessments(
        self, per_repo: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Merge current_state, dependencies, security, technical_debt across repos.

        Args:
            per_repo: List of per-repo extracted assessment dicts.

        Returns:
            Aggregated dict with merged sections.
        """
        all_languages: List[str] = []
        all_frameworks: List[str] = []
        all_build_tools: List[str] = []
        all_databases: List[str] = []
        all_deps: List[Dict[str, Any]] = []

        total_iam_violations = 0
        all_credential_issues: List[str] = []
        all_network_gaps: List[str] = []
        all_vulns: Dict[str, int] = {}
        total_eol = 0

        td_critical: List[Dict[str, Any]] = []
        td_high: List[Dict[str, Any]] = []
        td_medium: List[Dict[str, Any]] = []
        td_low: List[Dict[str, Any]] = []

        for repo_data in per_repo:
            if 'error' in repo_data:
                continue
            repo_name = repo_data.get('repo_name', 'unknown')

            # current_state
            cs = repo_data.get('current_state', {})
            if isinstance(cs, dict):
                for lang in cs.get('languages', []):
                    if lang and lang not in all_languages:
                        all_languages.append(lang)
                for fw in cs.get('frameworks', []):
                    if fw and fw not in all_frameworks:
                        all_frameworks.append(fw)
                for bt in cs.get('build_tools', []):
                    if bt and bt not in all_build_tools:
                        all_build_tools.append(bt)
                for db in cs.get('databases', []):
                    if db and db not in all_databases:
                        all_databases.append(db)

            # dependencies — tag each with source repo
            deps = repo_data.get('dependencies', [])
            if isinstance(deps, list):
                for dep in deps:
                    if isinstance(dep, dict):
                        dep_copy = dict(dep)
                        dep_copy['source_repo'] = repo_name
                        all_deps.append(dep_copy)

            # security
            sec = repo_data.get('security', {})
            if isinstance(sec, dict):
                total_iam_violations += sec.get('iam_violations_count', 0) or 0
                for ci in sec.get('credential_issues', []):
                    if ci:
                        all_credential_issues.append(f"[{repo_name}] {ci}")
                for ng in sec.get('network_gaps', []):
                    if ng:
                        all_network_gaps.append(f"[{repo_name}] {ng}")
                total_eol += sec.get('eol_component_count', 0) or 0
                for vuln in sec.get('vulnerabilities_by_severity', []):
                    if isinstance(vuln, dict):
                        sev = vuln.get('severity', 'unknown')
                        cnt = vuln.get('count', 0) or 0
                        all_vulns[sev] = all_vulns.get(sev, 0) + cnt

            # technical_debt — tag items with source repo
            td = repo_data.get('technical_debt', {})
            if isinstance(td, dict):
                for item in td.get('critical', []):
                    if isinstance(item, dict):
                        item_copy = dict(item)
                        item_copy['source_repo'] = repo_name
                        td_critical.append(item_copy)
                for item in td.get('high', []):
                    if isinstance(item, dict):
                        item_copy = dict(item)
                        item_copy['source_repo'] = repo_name
                        td_high.append(item_copy)
                for item in td.get('medium', []):
                    if isinstance(item, dict):
                        item_copy = dict(item)
                        item_copy['source_repo'] = repo_name
                        td_medium.append(item_copy)
                for item in td.get('low', []):
                    if isinstance(item, dict):
                        item_copy = dict(item)
                        item_copy['source_repo'] = repo_name
                        td_low.append(item_copy)

        return {
            'current_state': {
                'languages': all_languages,
                'frameworks': all_frameworks,
                'build_tools': all_build_tools,
                'databases': all_databases,
            },
            'dependencies': all_deps,
            'security': {
                'iam_violations_count': total_iam_violations,
                'credential_issues': all_credential_issues,
                'network_gaps': all_network_gaps,
                'vulnerabilities_by_severity': [
                    {'severity': sev, 'count': cnt}
                    for sev, cnt in sorted(all_vulns.items())
                ],
                'eol_component_count': total_eol,
            },
            'technical_debt': {
                'critical': td_critical,
                'high': td_high,
                'medium': td_medium,
                'low': td_low,
            },
        }

    @staticmethod
    def _infer_repo_roles(
        per_repo: List[Dict[str, Any]],
        repo_summaries: Dict[str, str],
    ) -> Dict[str, str]:
        """Infer a short role description for each repo from its assessment or summary.

        Args:
            per_repo: Per-repo assessment dicts.
            repo_summaries: Repo name → summary string from context chaining.

        Returns:
            Dict mapping repo_name → role description string.
        """
        roles: Dict[str, str] = {}
        for repo_data in per_repo:
            repo_name = repo_data.get('repo_name', 'unknown')
            # Prefer the AI-extracted summary
            summary = repo_data.get('summary', '')
            if not summary:
                summary = repo_summaries.get(repo_name, '')
            # Truncate to a concise role description
            if summary:
                roles[repo_name] = summary[:200]
            else:
                roles[repo_name] = 'No description available'
        return roles

    @staticmethod
    def _build_ordered_migration_plan(
        per_repo: List[Dict[str, Any]],
        execution_order: List[str],
        repo_roles: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        """Build a unified migration plan ordered by dependency execution order.

        Infrastructure repos come first, then databases, then backend services,
        then frontend — matching the topological execution order.

        Args:
            per_repo: Per-repo assessment dicts.
            execution_order: Topologically sorted repo names.
            repo_roles: Repo name → role description.

        Returns:
            Ordered list of migration phases.
        """
        repo_plans: Dict[str, List[Dict[str, Any]]] = {}
        for repo_data in per_repo:
            repo_name = repo_data.get('repo_name', 'unknown')
            plan = repo_data.get('migration_plan', [])
            if isinstance(plan, list):
                repo_plans[repo_name] = plan

        unified_plan: List[Dict[str, Any]] = []
        for phase_idx, repo_name in enumerate(execution_order, start=1):
            repo_phases = repo_plans.get(repo_name, [])
            phase: Dict[str, Any] = {
                'phase': phase_idx,
                'repo_name': repo_name,
                'role': repo_roles.get(repo_name, ''),
                'depends_on': [
                    r for r in execution_order[:phase_idx - 1]
                    # Only include direct dependencies that appear earlier
                ],
                'steps': repo_phases,
            }
            unified_plan.append(phase)

        return unified_plan

    @staticmethod
    def _build_combined_summary(
        per_repo: List[Dict[str, Any]],
        execution_order: List[str],
        aggregated: Dict[str, Any],
    ) -> str:
        """Build a concise executive summary for the combined assessment.

        Args:
            per_repo: Per-repo assessment dicts.
            execution_order: Topologically sorted repo names.
            aggregated: Aggregated assessment sections.

        Returns:
            Summary string.
        """
        total = len(execution_order)
        successful = len([r for r in per_repo if 'error' not in r])
        langs = aggregated.get('current_state', {}).get('languages', [])
        sec = aggregated.get('security', {})
        td = aggregated.get('technical_debt', {})
        critical_count = len(td.get('critical', []))
        high_count = len(td.get('high', []))

        lang_str = ', '.join(langs[:5]) if langs else 'unknown'
        parts = [
            f"Combined analysis of {total} repositories ({successful} successful).",
            f"Technology stack spans {lang_str}.",
        ]
        if critical_count or high_count:
            parts.append(
                f"Identified {critical_count} critical and {high_count} high "
                f"technical debt items across all repos."
            )
        vuln_total = sum(
            v.get('count', 0)
            for v in sec.get('vulnerabilities_by_severity', [])
        )
        if vuln_total:
            parts.append(f"{vuln_total} security vulnerabilities detected.")

        return ' '.join(parts)

    def _store_combined_assessment(
        self, app_id: str, run_id: str, data: Dict[str, Any],
    ) -> None:
        """Store the aggregated combined assessment in DynamoDB.

        Uses repo_name='combined-phased' to distinguish from per-repo assessments.

        Args:
            app_id: Application identifier.
            run_id: Run identifier.
            data: Full combined assessment dict.
        """
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.table_name)
        item = {
            'application_id': app_id,
            'repo_run_key': f'{run_id}#combined-phased',
            'run_id': run_id,
            'repo_name': 'combined-phased',
            'assessed_at': datetime.now().isoformat(),
            'repos': json.dumps(data.get('repos', [])),
            'dependency_analysis': json.dumps(data.get('dependency_analysis', {})),
            'aggregated': json.dumps(data.get('aggregated', {})),
            'migration_plan': json.dumps(data.get('migration_plan', [])),
            'summary': data.get('summary', ''),
            # Also store the standard fields from aggregated for backward compat
            'current_state': json.dumps(
                data.get('aggregated', {}).get('current_state', {})
            ),
            'dependencies': json.dumps(
                data.get('aggregated', {}).get('dependencies', [])
            ),
            'security': json.dumps(
                data.get('aggregated', {}).get('security', {})
            ),
            'technical_debt': json.dumps(
                data.get('aggregated', {}).get('technical_debt', {})
            ),
        }
        table.put_item(Item=item)
        logger.info(
            f"Stored combined-phased assessment for {app_id} (run: {run_id})"
        )

    def get_assessments(self, app_id: str) -> List[Dict[str, Any]]:
        """Get all ATX assessments for an application."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.table_name)
        try:
            resp = table.query(
                KeyConditionExpression='application_id = :aid',
                ExpressionAttributeValues={':aid': app_id},
                ScanIndexForward=False
            )
        except Exception:
            # Fallback: table schema may require sort key — use scan instead
            resp = table.scan(
                FilterExpression='application_id = :aid',
                ExpressionAttributeValues={':aid': app_id},
            )
        items = resp.get('Items', [])
        # Parse JSON fields back
        json_fields = [
            'system_overview', 'current_state', 'target_state', 'dependencies',
            'breaking_changes', 'security', 'technical_debt', 'outdated_components',
            'complexity', 'migration_plan', 'component_order', 'test_specifications',
            'validation_criteria', 'remediation_plan', 'component_inventory',
            'data_stores', 'diagrams',
            # Legacy fields (backward compatibility with older records)
            'project_overview', 'components', 'design_patterns',
            'program_structure', 'business_logic', 'workflows', 'decision_logic',
            'error_handling', 'system_context_diagram', 'component_diagram',
            'sequence_diagram', 'interfaces', 'data_models', 'api_reference',
            'security_patterns', 'code_metrics', 'complexity_analysis',
            'dependency_analysis', 'technical_debt_summary', 'technical_debt_report',
            'maintenance_burden', 'api_surface', 'deployment_topology',
            # Combined-phased specific fields
            'repos', 'aggregated',
        ]
        for item in items:
            for fld in json_fields:
                if fld in item and isinstance(item[fld], str):
                    try:
                        item[fld] = json.loads(item[fld])
                    except json.JSONDecodeError:
                        pass
        return items

    def get_latest_assessment(self, app_id: str, run_id: str = None) -> Optional[Dict[str, Any]]:
        """Get ATX assessments for an application, optionally filtered by run_id."""
        items = self.get_assessments(app_id)
        if not items:
            return None
        # Filter out combined-phased aggregate records
        items = [i for i in items if i.get('repo_name') != 'combined-phased']
        if not items:
            return None

        if run_id:
            # Return assessments for the specific run
            run_items = [i for i in items if i.get('run_id') == run_id]
            if run_items:
                return {
                    'application_id': app_id,
                    'run_id': run_id,
                    'repos': run_items,
                    'repo_count': len(run_items)
                }

        # Fallback: find the most recent run that has assessment data
        # Sort by assessed_at descending, group by run_id, return first non-empty
        from collections import OrderedDict
        runs: OrderedDict = OrderedDict()
        for item in sorted(items, key=lambda i: i.get('assessed_at', ''), reverse=True):
            rid = item.get('run_id', '')
            if rid not in runs:
                runs[rid] = []
            runs[rid].append(item)

        # Return the first (most recent) run that has items
        for rid, run_items in runs.items():
            if run_items:
                return {
                    'application_id': app_id,
                    'run_id': rid,
                    'repos': run_items,
                    'repo_count': len(run_items)
                }

        return None
