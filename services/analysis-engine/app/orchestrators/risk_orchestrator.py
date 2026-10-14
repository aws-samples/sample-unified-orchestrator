"""
Risk Orchestrator Service

Orchestrates the risk assessment workflow with:
1. Parallel execution of independent nodes
2. Connection pooling for boto3 clients
3. Batch DynamoDB operations
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

import botocore.exceptions

from app.config import Config

logger = logging.getLogger(__name__)


class RiskOrchestrator:
    """
    Orchestrator for risk assessment workflow with parallel execution.

    Workflow:
    1. retriever -> Fetch components and repos
    2. [component_analyzer, scm_analyzer, team_readiness, business_readiness] (PARALLEL)
    3. aggregator -> Combine all results
    """

    def __init__(self, use_cache: bool = False, max_workers: int = 4):
        """
        Initialize the orchestrator.

        Args:
            use_cache: Deprecated - kept for backward compatibility
            max_workers: Max parallel workers (default: 4)
        """
        self.results = {}
        self.use_cache = False  # Redis removed
        self.max_workers = max_workers
        self._cache = None
        self._boto_clients = {}

    def _get_boto_client(self, service: str):
        """Get or create boto3 client with connection pooling using Config."""
        if service not in self._boto_clients:
            self._boto_clients[service] = Config.get_boto3_client(service)

        return self._boto_clients[service]

    def execute(
        self,
        app_id: str,
        team_readiness_inputs: Optional[Dict[str, Any]] = None,
        business_readiness_inputs: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute the assessment workflow graph.

        Args:
            app_id: Application ID to assess
            team_readiness_inputs: Optional team readiness input data
            business_readiness_inputs: Optional business readiness input data

        Returns:
            Comprehensive assessment report
        """
        start_time = time.time()
        logger.info(f"Starting graph orchestration for application {app_id}")

        try:
            # Node 1: Retriever (entry point) - MUST run first
            logger.info("Executing retriever node...")
            retriever_start = time.time()
            retriever_result = self._execute_retriever(app_id)
            retriever_time = time.time() - retriever_start
            logger.info(f"Retriever completed in {retriever_time:.2f}s")
            self.results['retriever'] = retriever_result

            if retriever_result.get('error'):
                logger.error(f"Retriever failed: {retriever_result['error']}")
                return self._create_error_response(app_id, "Retriever failed")

            # Nodes 2-5: Execute in PARALLEL (all depend only on retriever)
            logger.info("Executing parallel nodes (component_analyzer, scm_analyzer, team, business)...")
            parallel_start = time.time()

            parallel_results = {}
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                # Submit all parallel tasks
                futures = {
                    executor.submit(self._execute_component_analyzer, retriever_result): 'component_analyzer',
                    executor.submit(self._execute_scm_analyzer, retriever_result): 'scm_analyzer',
                    executor.submit(self._execute_team_readiness, team_readiness_inputs): 'team_readiness',
                    executor.submit(self._execute_business_readiness, business_readiness_inputs): 'business_readiness'
                }

                # Collect results as they complete
                for future in as_completed(futures):
                    node_name = futures[future]
                    try:
                        result = future.result()
                        parallel_results[node_name] = result
                        self.results[node_name] = result
                        logger.info(f"✓ {node_name} completed")
                    except botocore.exceptions.ClientError as e:
                        error_code = e.response['Error']['Code']
                        error_msg = e.response['Error']['Message']
                        logger.error(
                            f"✗ {node_name} Bedrock error: {error_code} — {error_msg} "
                            f"(app={app_id})"
                        )
                        parallel_results[node_name] = {
                            'error': f'Bedrock {error_code}: {error_msg}',
                            'error_type': error_code,
                        }
                        self.results[node_name] = parallel_results[node_name]
                    except Exception as e:
                        logger.error(f"✗ {node_name} failed: {type(e).__name__}: {e}")
                        parallel_results[node_name] = {'error': str(e)}
                        self.results[node_name] = {'error': str(e)}

            parallel_time = time.time() - parallel_start
            logger.info(f"Parallel nodes completed in {parallel_time:.2f}s")

            # Enrich version gap using component analysis target versions
            self._enrich_version_gap(
                parallel_results.get('scm_analyzer', {}),
                parallel_results.get('component_analyzer', {})
            )

            # Node 6: Aggregator (depends on all above) - MUST run last
            logger.info("Executing aggregator node...")
            aggregator_start = time.time()
            final_result = self._execute_aggregator(
                retriever_result,
                parallel_results.get('component_analyzer', {}),
                parallel_results.get('scm_analyzer', {}),
                parallel_results.get('team_readiness', {}),
                parallel_results.get('business_readiness', {})
            )
            aggregator_time = time.time() - aggregator_start
            logger.info(f"Aggregator completed in {aggregator_time:.2f}s")
            self.results['aggregator'] = final_result

            total_time = time.time() - start_time
            logger.info(f"✓ Graph orchestration complete in {total_time:.2f}s")
            logger.info(f"  Breakdown: retriever={retriever_time:.2f}s, parallel={parallel_time:.2f}s, aggregator={aggregator_time:.2f}s")

            # Add performance metrics to result
            final_result['performance_metrics'] = {
                'total_time': total_time,
                'retriever_time': retriever_time,
                'parallel_time': parallel_time,
                'aggregator_time': aggregator_time,
                'optimization': 'parallel_execution'
            }

            return final_result

        except Exception as e:
            logger.error(f"Error in graph orchestration: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._create_error_response(app_id, str(e))

    def _execute_retriever(self, app_id: str) -> Dict[str, Any]:
        """Execute retriever tool."""
        from app.strands.tools.risks.retriever import retriever
        return retriever(app_id)

    def _execute_component_analyzer(self, retriever_result: Dict[str, Any]) -> Dict[str, Any]:
        """Execute component analyzer tool with caching."""
        from app.strands.tools.risks.component_analyzer import component_analyzer

        unique_components = retriever_result.get('unique_components', [])
        app_name = retriever_result.get('application_info', {}).get('app_name')

        # Pass cache and boto client for optimization
        kwargs = {}
        if self.use_cache and self._cache:
            kwargs['cache'] = self._cache
        kwargs['dynamodb_client'] = self._get_boto_client('dynamodb')

        return component_analyzer(unique_components, app_name, **kwargs)

    def _execute_scm_analyzer(self, retriever_result: Dict[str, Any]) -> Dict[str, Any]:
        """Execute SCM analyzer with real repository data via SCMService.

        Analyzes ALL configured repository URLs and merges the results so that
        the complexity tab reflects data from every repo.
        """
        from app.strands.tools.risks.analyze_scm import analyze_scm

        app_id = retriever_result.get('app_id', '')
        repository_urls = retriever_result.get('repository_urls', [])

        # Default result used when no SCM URL or analysis fails
        default_result = {
            'source_code_score': 0, 'cicd_score': 0, 'code_quality_score': 0,
            'documentation_score': 0, 'monitoring_score': 0,
            'vulnerability_risk_score': 0, 'complexity_score': 0,
            'overall_scm_readiness': 0, 'integration_count': 0,
            'version_gap': 0, 'application_type': 'Unknown',
            'testing_maturity': 'No Tests', 'cicd_maturity': 'none',
            'documentation_quality': 'none', 'monitoring_maturity': 'none',
            'code_coverage': 0, 'blockers': [], 'warnings': [], 'recommendations': [],
            'source_code_repos': [], 'cicd_details': [], 'documentation_details': [],
            'monitoring_details': [], 'coverage_details': [],
            'integrations': [], 'integrations_by_type': {},
            'testing_details': [], 'testing_frameworks': [],
            'application_type_details': [], 'version_gap_details_list': [],
        }

        if not repository_urls:
            logger.warning(f"No SCM URLs configured for app {app_id}")
            default_result['warnings'] = [
                {'type': 'source_code', 'severity': 'high',
                 'message': 'No SCM URL configured for this application',
                 'action': 'Add a repository URL to the application configuration'}
            ]
            return default_result

        # Analyze ALL repository URLs and collect results
        from app.services.scm_service import SCMService
        scm_service = SCMService()
        repo_analyses = []

        for repo_url in repository_urls:
            try:
                repo_analysis = scm_service.analyze_repository(repo_url)
                repo_analyses.append(repo_analysis)
                logger.info(f"SCMService analysis complete for {app_id} repo={repo_url} "
                            f"(deps={repo_analysis['dependencies']['count']}, "
                            f"time={repo_analysis.get('analysis_time_seconds', '?')}s)")
            except Exception as e:
                logger.error(f"SCMService failed for {app_id} repo={repo_url}: {e}")

        if not repo_analyses:
            default_result['warnings'] = [
                {'type': 'source_code', 'severity': 'high',
                 'message': 'All repository analyses failed',
                 'action': 'Check repository URLs and GITHUB_TOKEN configuration'}
            ]
            return default_result

        # Merge results from all repos
        merged = self._merge_repo_analyses(repo_analyses, repository_urls)
        primary = repo_analyses[0]

        scm_data = {
            'source_code_available': any(r.get('success', False) for r in repo_analyses),
            'source_code_documented': any(r['documentation']['has_readme'] for r in repo_analyses),
            'repository_url': ', '.join(repository_urls[:len(repo_analyses)]),
            'code_coverage': max(r['testing']['estimated_coverage'] for r in repo_analyses),
            'lines_of_code': 'Unknown',
        }

        cicd_priority = {'full CI/CD': 5, 'CI only': 4, 'basic CI/CD': 3, 'build only': 2, 'IaC only': 2, 'basic': 3, 'full': 5, 'minimal': 2, 'none': 1}
        best_cicd = max(repo_analyses, key=lambda r: cicd_priority.get(r['cicd']['maturity'], 0))
        cicd_data = {
            'cicd_maturity': best_cicd['cicd']['maturity'],
            'build_automation': 'build' in best_cicd['cicd'].get('stages', []),
            'deployment_automation': 'deploy' in best_cicd['cicd'].get('stages', []),
            'pipeline_url': None,
        }

        code_quality_data = {
            'vulnerabilities': 0, 'code_smells': 0, 'technical_debt_hours': 0,
            'complexity_score': 0,
            'documentation_quality': merged['documentation_quality'],
            'monitoring_maturity': merged['monitoring_maturity'],
            'integration_count': merged['integration_count'],
        }

        try:
            ai_result = analyze_scm(app_id=app_id, scm_data=scm_data, cicd_data=cicd_data, code_quality_data=code_quality_data)
        except Exception as e:
            logger.error(f"AI SCM analysis failed for {app_id}: {e}")
            ai_result = dict(default_result)
            ai_result['error'] = str(e)

        # Enrich AI result with merged pass-through fields
        ai_result.setdefault('integration_count', merged['integration_count'])
        ai_result.setdefault('integrations', merged['integrations'])
        ai_result.setdefault('integrations_by_type', merged['integrations_by_type'])

        ai_result['version_gap'] = 0
        ai_result['version_gap_details_list'] = merged['language_versions']
        if merged['language_versions']:
            first_lang = merged['language_versions'][0]
            ai_result['version_gap_details'] = {
                'language': first_lang.get('language', 'Unknown'),
                'current_version': first_lang.get('current_version', 'Not detected'),
                'current_major': first_lang.get('major_version'),
                'target_version': None, 'target_major': None, 'gap': 0,
            }
        else:
            ai_result['version_gap_details'] = {
                'language': 'Unknown', 'current_version': 'Not detected',
                'current_major': None, 'target_version': None, 'target_major': None, 'gap': 0,
            }

        ai_result.setdefault('application_type', merged['application_type'])
        ai_result.setdefault('application_type_label', merged['application_type_label'])
        ai_result.setdefault('application_type_framework', merged['application_type_framework'])
        ai_result.setdefault('application_type_details', merged.get('application_type_details', []))
        ai_result.setdefault('testing_maturity', merged['testing_maturity'])
        ai_result.setdefault('testing_details', merged['testing_details'])
        ai_result.setdefault('testing_frameworks', merged['testing_frameworks'])
        ai_result.setdefault('testing_estimated_coverage', merged['testing_estimated_coverage'])
        ai_result.setdefault('cicd_maturity', best_cicd['cicd']['maturity'])
        ai_result.setdefault('cicd_details', merged.get('cicd_details', []))
        ai_result.setdefault('documentation_quality', merged['documentation_quality'])
        ai_result.setdefault('documentation_details', merged.get('documentation_details', []))
        ai_result.setdefault('monitoring_maturity', merged['monitoring_maturity'])
        ai_result.setdefault('monitoring_details', merged.get('monitoring_details', []))
        ai_result.setdefault('coverage_details', merged.get('coverage_details', []))
        ai_result.setdefault('code_coverage', merged['testing_estimated_coverage'])

        ai_result['repo_analyses'] = repo_analyses
        ai_result['repo_analysis'] = primary

        ai_result['source_code_repos'] = []
        for i, ra in enumerate(repo_analyses):
            repo_url = repository_urls[i] if i < len(repository_urls) else ''
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            lang = ra.get('language_version', {})
            ai_result['source_code_repos'].append({
                'repository': repo_name, 'url': repo_url,
                'language': lang.get('language', 'Unknown'),
                'available': ra.get('success', False),
            })

        return ai_result

    def _merge_repo_analyses(self, analyses: list, urls: list) -> Dict[str, Any]:
        """Merge results from multiple repository analyses into a single combined view."""
        all_integrations = []
        seen_integrations = set()
        integrations_by_type: Dict[str, int] = {}
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            for integ in ra['dependencies'].get('integrations', []):
                key = f"{integ.get('type', '')}|{integ.get('detail', '')}"
                if key not in seen_integrations:
                    seen_integrations.add(key)
                    tagged = dict(integ)
                    tagged.setdefault('repository', repo_name)
                    all_integrations.append(tagged)
            for itype, count in ra['dependencies'].get('integrations_by_type', {}).items():
                integrations_by_type[itype] = integrations_by_type.get(itype, 0) + count

        language_versions = []
        for i, ra in enumerate(analyses):
            lv = ra.get('language_version', {})
            if lv.get('language') and lv['language'] != 'Unknown':
                lv_entry = dict(lv)
                lv_entry['repo_url'] = urls[i] if i < len(urls) else 'Unknown'
                language_versions.append(lv_entry)

        all_testing_details = []
        all_testing_frameworks = set()
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            for td in ra['testing'].get('details', []):
                tagged = dict(td)
                tagged['repository'] = repo_name
                all_testing_details.append(tagged)
            for fw in ra['testing'].get('frameworks', []):
                all_testing_frameworks.add(fw)

        testing_priority = {'Full Pyramid': 4, 'Unit + Integration': 3, 'Unit Only': 2, 'No Tests': 1, 'Unknown': 0}
        best_testing = max(analyses, key=lambda r: testing_priority.get(r['testing']['maturity'], 0))

        doc_priority = {'comprehensive': 4, 'good': 3, 'basic': 2, 'minimal': 1, 'none': 0}
        best_doc = max(analyses, key=lambda r: doc_priority.get(r['documentation']['quality'], 0))

        documentation_details = []
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            doc = ra.get('documentation', {})
            documentation_details.append({
                'repository': repo_name, 'quality': doc.get('quality', 'none'),
                'has_readme': doc.get('has_readme', False),
                'has_api_docs': doc.get('has_api_docs', False),
                'has_architecture': doc.get('has_architecture', False),
            })

        mon_priority = {'comprehensive': 4, 'good': 3, 'basic': 2, 'minimal': 1, 'none': 0}
        best_mon = max(analyses, key=lambda r: mon_priority.get(r['monitoring']['maturity'], 0))

        monitoring_details = []
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            mon = ra.get('monitoring', {})
            monitoring_details.append({
                'repository': repo_name, 'maturity': mon.get('maturity', 'none'),
                'tools': ', '.join(mon.get('tools', [])) or 'None',
                'has_logging': mon.get('has_logging', False),
                'has_tracing': mon.get('has_tracing', False),
            })

        coverage_details = []
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            testing = ra.get('testing', {})
            coverage_details.append({
                'repository': repo_name,
                'estimated_coverage': testing.get('estimated_coverage', 0),
                'coverage_source': testing.get('coverage_source', 'file-ratio'),
                'maturity': testing.get('maturity', 'Unknown'),
                'frameworks': ', '.join(testing.get('frameworks', [])) or 'None',
            })

        cicd_details = []
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            cicd = ra.get('cicd', {})
            cicd_details.append({
                'repository': repo_name, 'maturity': cicd.get('maturity', 'none'),
                'tool': cicd.get('tool', 'None'),
                'has_pipeline': cicd.get('has_pipeline', False),
                'has_iac': cicd.get('has_iac', False),
                'iac_tool': cicd.get('iac_tool', 'None'),
                'stages': ', '.join(cicd.get('stages', [])) or 'None',
            })

        app_type_details = []
        app_type_entry = {'type': 'Unknown', 'label': 'Unknown', 'framework': 'Unknown'}
        app_type_scores = {
            'REST API': 10, 'Stateless API': 10, 'Web Application': 25,
            'Stateful Web': 25, 'Event-Driven': 40, 'Socket-Based': 60,
            'Containerized': 30, 'Legacy': 80, 'Mainframe': 100,
        }
        max_app_type_score = 0
        for i, ra in enumerate(analyses):
            repo_url = urls[i] if i < len(urls) else 'Unknown'
            repo_name = repo_url.rstrip('/').rsplit('/', 1)[-1] if repo_url else f'Repo {i+1}'
            at = ra['application_type']
            app_type = at.get('type', 'Unknown')
            score = app_type_scores.get(app_type, 50)
            app_type_details.append({'repository': repo_name, 'type': app_type, 'framework': at.get('framework', 'Unknown'), 'score': score})
            if app_type != 'Unknown' and score > max_app_type_score:
                max_app_type_score = score
                app_type_entry = at
        if app_type_entry['type'] == 'Unknown' and app_type_details:
            app_type_entry = analyses[0]['application_type']

        return {
            'integration_count': len(all_integrations), 'integrations': all_integrations,
            'integrations_by_type': integrations_by_type, 'language_versions': language_versions,
            'testing_maturity': best_testing['testing']['maturity'],
            'testing_details': all_testing_details, 'testing_frameworks': list(all_testing_frameworks),
            'testing_estimated_coverage': max(r['testing']['estimated_coverage'] for r in analyses),
            'documentation_quality': best_doc['documentation']['quality'],
            'documentation_details': documentation_details,
            'monitoring_maturity': best_mon['monitoring']['maturity'],
            'monitoring_details': monitoring_details, 'coverage_details': coverage_details,
            'cicd_details': cicd_details,
            'application_type': app_type_entry['type'],
            'application_type_label': app_type_entry['label'],
            'application_type_framework': app_type_entry['framework'],
            'application_type_details': app_type_details,
        }

    def _enrich_version_gap(self, scm_result: Dict[str, Any], component_result: Dict[str, Any]) -> None:
        """Enrich version gap by comparing repo languages against customer's approved target versions."""
        details_list = scm_result.get('version_gap_details_list', [])
        components = component_result.get('components', [])

        language_product_keywords = {
            'Java': ['java', 'jdk', 'jre', 'openjdk'],
            'Python': ['python', 'cpython'],
            'Node.js': ['node', 'nodejs', 'node.js'],
        }

        enriched_rows = []
        max_gap = 0

        for lang_info in details_list:
            language = lang_info.get('language', 'Unknown')
            current_major = lang_info.get('major_version')
            current_version = lang_info.get('current_version', 'Not detected')

            if language == 'Unknown' or current_major is None:
                enriched_rows.append({'language': language, 'current_version': current_version, 'target_version': 'N/A', 'gap': 0})
                continue

            keywords = language_product_keywords.get(language, [language.lower()])

            target_version = None
            target_major = None
            for comp in components:
                product = (comp.get('product') or '').lower()
                category = (comp.get('category') or '').lower()
                sub_category = (comp.get('subcategory') or comp.get('sub_category') or '').lower()

                is_match = (
                    any(kw in product for kw in keywords) or
                    ('programming' in category and any(kw in product for kw in keywords)) or
                    ('programming' in sub_category and any(kw in product for kw in keywords))
                )

                if is_match and comp.get('matched') and comp.get('target_version'):
                    tv = comp['target_version']
                    if isinstance(tv, dict):
                        tv = tv.get('version', '')
                    if tv and tv != 'Not Available':
                        target_version = tv
                        try:
                            parts = tv.split('.')
                            tmajor = int(parts[0])
                            if tmajor == 1 and len(parts) > 1:
                                tmajor = int(parts[1])
                            target_major = tmajor
                        except (ValueError, IndexError):
                            pass
                        break

            gap = max(0, abs(target_major - current_major)) if target_major is not None else 0
            max_gap = max(max_gap, gap)

            enriched_rows.append({
                'language': language, 'current_version': current_version,
                'target_version': target_version or 'Not found in approved list',
                'target_major': target_major, 'gap': gap,
            })
            logger.info(f"Version gap: {language} {current_version} -> {target_version} (gap={gap})")

        if not details_list:
            single = scm_result.get('version_gap_details', {})
            if single.get('language') and single['language'] != 'Unknown':
                enriched_rows.append({
                    'language': single['language'],
                    'current_version': single.get('current_version', 'Not detected'),
                    'target_version': 'Not found in approved list', 'gap': 0,
                })

        scm_result['version_gap'] = max_gap
        scm_result['version_gap_details_list'] = enriched_rows
        if enriched_rows:
            scm_result['version_gap_details'] = enriched_rows[0]

    def _execute_team_readiness(self, team_readiness_inputs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Execute team readiness analyzer tool."""
        from app.strands.tools.risks.assess_team_readiness import assess_team_readiness

        if not team_readiness_inputs:
            team_readiness_inputs = {
                'team_availability': 'Dedicated',
                'skill_level': 'Expert',
                'knowledge_transfer': 'Full docs + devs',
                'training_completed': 'All trained'
            }

        # Call with unpacked dict as keyword arguments
        return assess_team_readiness(
            team_availability=team_readiness_inputs.get('team_availability', 'None'),
            skill_level=team_readiness_inputs.get('skill_level', 'No experience'),
            knowledge_transfer=team_readiness_inputs.get('knowledge_transfer', 'None'),
            training_completed=team_readiness_inputs.get('training_completed', 'No training')
        )

    def _execute_business_readiness(self, business_readiness_inputs: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Execute business readiness analyzer tool."""
        from app.strands.tools.risks.assess_business_readiness import assess_business_readiness

        if not business_readiness_inputs:
            business_readiness_inputs = {
                'maintenance_window': 'Flexible',
                'business_calendar': 'Off-peak',
                'stakeholder_alignment': 'Full buy-in',
                'budget_availability': 'Fully funded'
            }

        # Call with unpacked dict as keyword arguments
        return assess_business_readiness(
            maintenance_window=business_readiness_inputs.get('maintenance_window', 'No downtime'),
            business_calendar=business_readiness_inputs.get('business_calendar', 'Peak season'),
            stakeholder_alignment=business_readiness_inputs.get('stakeholder_alignment', 'Strong resistance'),
            budget_availability=business_readiness_inputs.get('budget_availability', 'No budget')
        )

    def _execute_aggregator(
        self,
        retriever_result: Dict[str, Any],
        component_result: Dict[str, Any],
        scm_result: Dict[str, Any],
        team_result: Dict[str, Any],
        business_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute aggregator tool."""
        from app.strands.tools.risks.aggregator import aggregator

        return aggregator(
            retriever_result,
            component_result,
            scm_result,
            team_result,
            business_result
        )

    def _create_error_response(self, app_id: str, error_message: str) -> Dict[str, Any]:
        """Create error response."""
        return {
            'app_id': app_id,
            'error': error_message,
            'timestamp': datetime.now().isoformat(),
            'executive_summary': {},
            'component_analysis': {},
            'scm_analysis': {},
            'team_readiness': {},
            'business_readiness': {},
            'complexity_metrics': {},
            'categories': {}
        }

    def close(self):
        """Close connections and cleanup."""
        if self._cache:
            try:
                self._cache.close()
            except:
                pass

        self._boto_clients.clear()
