"""ATX Orchestrator — runs ATX analysis then AI extraction sequentially."""
import logging
import time
import json
from datetime import datetime
from typing import Dict, Any, List, Optional

from app.config import Config

logger = logging.getLogger(__name__)


class ATXOrchestrator:
    """Orchestrates ATX code analysis pipeline: Tool 1 (ATX run) -> Tool 2 (AI extraction)."""

    def __init__(self):
        self.tasks_table_name = Config.ATX_PROCESSING_TASKS_TABLE

    def _update_task(self, task_id: str, status: str, **kwargs):
        """Update processing task in DynamoDB."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.tasks_table_name)
        update_expr = 'SET #s = :s, updated_at = :t'
        attr_names = {'#s': 'status'}
        attr_values = {':s': status, ':t': datetime.now().isoformat()}
        for k, v in kwargs.items():
            update_expr += f', {k} = :{k}'
            attr_values[f':{k}'] = v if isinstance(v, str) else json.dumps(v)
        table.update_item(
            Key={'task_id': task_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=attr_names,
            ExpressionAttributeValues=attr_values
        )

    def execute(self, task_id: str, app_id: str, selected_files: Optional[List[str]] = None, selected_repos: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Execute the full ATX pipeline: ATX CLI run -> AI assessment extraction.

        Args:
            task_id: Processing task ID for status tracking
            app_id: Application ID
            selected_files: Optional list of S3 keys for context files
            selected_repos: Optional list of repo URLs to analyze (subset of SCM_URLS)
        """
        start_time = time.time()
        logger.info(f"[ATX Orchestrator] Starting for {app_id} (task: {task_id})")

        try:
            # Step 1: Run ATX analysis
            self._update_task(task_id, 'processing')
            logger.info(f"[ATX Orchestrator] Step 1: Running ATX CLI analysis")

            from app.strands.tools.atx.run_atx_analysis import run_atx_analysis
            atx_result = run_atx_analysis(app_id, selected_files, selected_repos)

            if not atx_result.get('success'):
                error = atx_result.get('error', 'ATX analysis failed')
                self._update_task(task_id, 'failed', error_message=error)
                return {'success': False, 'error': error, 'step': 'atx_run'}

            run_id = atx_result.get('run_id', '')
            repo_results = atx_result.get('results', [])
            successful_repos = [r for r in repo_results if r.get('atx_success') and r.get('upload', {}).get('success')]

            step1_time = time.time() - start_time
            logger.info(f"[ATX Orchestrator] Step 1 complete: {len(successful_repos)}/{len(repo_results)} repos ({step1_time:.1f}s)")
            self._update_task(task_id, 'atx_complete', atx_results=atx_result)

            if not successful_repos:
                failed_repos = [r for r in repo_results if not r.get('atx_success')]
                errors = '; '.join(f"{r.get('repo_name','?')}: {r.get('atx_error','unknown')}" for r in failed_repos)
                self._update_task(task_id, 'failed', error_message=f'ATX failed for all repos: {errors}', atx_results=atx_result)
                return {'success': False, 'error': 'ATX failed for all repos', 'atx_result': atx_result}

            # Step 2: Extract structured assessment with AI
            self._update_task(task_id, 'extracting')
            logger.info(f"[ATX Orchestrator] Step 2: Extracting assessment with AI")

            from app.strands.tools.atx.extract_atx_assessment import extract_atx_assessment
            extract_result = extract_atx_assessment(app_id, run_id, successful_repos)

            step2_time = time.time() - start_time - step1_time
            total_time = time.time() - start_time
            logger.info(f"[ATX Orchestrator] Step 2 complete ({step2_time:.1f}s). Total: {total_time:.1f}s")

            self._update_task(task_id, 'completed', assessment_results=extract_result,
                             s3_prefix=f'atx-results/{app_id}/{run_id}')

            return {
                'success': True,
                'app_id': app_id,
                'run_id': run_id,
                'atx_result': atx_result,
                'assessment_result': extract_result,
                'performance': {
                    'total_time': total_time,
                    'atx_run_time': step1_time,
                    'extraction_time': step2_time
                }
            }

        except Exception as e:
            logger.error(f"[ATX Orchestrator] Failed for {app_id}: {e}", exc_info=True)
            self._update_task(task_id, 'failed', error_message=str(e))
            return {'success': False, 'error': str(e)}
