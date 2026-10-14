"""Startup task reconciler — checks in-progress ATX tasks against ECS status.

On ARA server startup, finds all DynamoDB tasks stuck in 'processing' state,
checks their ECS task status, and updates accordingly:
- ECS task RUNNING → leave it alone
- ECS task STOPPED (exit 0) → mark completed, trigger assessment extraction
- ECS task STOPPED (non-zero) → mark failed
- No ECS ARN (local mode) → mark failed (server restarted, thread pool lost)
"""
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from app.config import Config

logger = logging.getLogger(__name__)


def reconcile_in_progress_tasks() -> Dict[str, Any]:
    """Reconcile all in-progress ATX tasks against ECS task status.

    Returns summary of actions taken.
    """
    dynamodb = Config.get_boto3_resource('dynamodb')
    table = dynamodb.Table(Config.ATX_PROCESSING_TASKS_TABLE)

    # Find all tasks with status = 'processing'
    try:
        resp = table.scan(
            FilterExpression='#s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'processing'},
        )
        in_progress = resp.get('Items', [])
    except Exception as e:
        logger.error(f"[Reconciler] Failed to scan for in-progress tasks: {e}")
        return {'success': False, 'error': str(e)}

    if not in_progress:
        logger.info("[Reconciler] No in-progress tasks found — nothing to reconcile")
        return {'success': True, 'reconciled': 0, 'total_in_progress': 0}

    logger.info(f"[Reconciler] Found {len(in_progress)} in-progress task(s) to reconcile")

    ecs_client = None
    cluster = Config.ECS_CLUSTER
    if cluster:
        try:
            ecs_client = Config.get_boto3_client('ecs')
        except Exception as e:
            logger.warning(f"[Reconciler] Cannot create ECS client: {e}")

    results = {'reconciled': 0, 'left_running': 0, 'marked_completed': 0, 'marked_failed': 0}

    for task in in_progress:
        task_id = task['task_id']
        task_type = task.get('task_type', 'atx_run')
        app_id = task.get('application_id', '')
        run_id = task.get('run_id', '')

        # Get ECS ARN(s) for this task
        ecs_task_arn = task.get('ecs_task_arn', '')  # combined + transform
        ecs_task_arns = task.get('ecs_task_arns', {})  # per-repo analysis

        # Collect all ARNs to check
        arns_to_check: List[str] = []
        if ecs_task_arn:
            arns_to_check.append(ecs_task_arn)
        if ecs_task_arns:
            arns_to_check.extend([arn for arn in ecs_task_arns.values() if arn])

        if not arns_to_check:
            # No ECS ARN — local mode task that lost its thread
            logger.warning(f"[Reconciler] AppID={app_id} Task={task_id} — no ECS ARN, marking FAILED (server restart)")
            _update_task_status(table, task_id, 'failed', error='Server restarted — local worker lost')
            results['marked_failed'] += 1
            results['reconciled'] += 1
            continue

        if not ecs_client or not cluster:
            # Can't reach ECS — check S3 for results as fallback
            s3_prefix = task.get('s3_prefix', '')
            if s3_prefix:
                try:
                    s3 = Config.get_boto3_client('s3')
                    bucket = Config.S3_ARA_BUCKET
                    resp = s3.list_objects_v2(Bucket=bucket, Prefix=s3_prefix, MaxKeys=5)
                    has_results = len(resp.get('Contents', [])) > 0
                    if has_results:
                        logger.info(f"[Reconciler] AppID={app_id} Task={task_id} — S3 results found, marking COMPLETED")
                        _update_task_status(table, task_id, 'completed')
                        results['marked_completed'] += 1
                        results['reconciled'] += 1
                        _trigger_assessment_extraction(task_id, app_id, run_id, task_type, task)
                    else:
                        logger.info(f"[Reconciler] AppID={app_id} Task={task_id} — no S3 results, marking FAILED")
                        _update_task_status(table, task_id, 'failed', error='No ECS access and no S3 results found')
                        results['marked_failed'] += 1
                        results['reconciled'] += 1
                except Exception as e:
                    logger.warning(f"[Reconciler] AppID={app_id} Task={task_id} — S3 check failed, skipping: {e}")
            else:
                logger.info(f"[Reconciler] AppID={app_id} Task={task_id} — no ECS access, no S3 prefix, marking FAILED")
                _update_task_status(table, task_id, 'failed', error='No ECS access and no S3 prefix configured')
                results['marked_failed'] += 1
                results['reconciled'] += 1
            continue

        # Check ECS task status
        try:
            ecs_resp = ecs_client.describe_tasks(cluster=cluster, tasks=arns_to_check)
            ecs_tasks = ecs_resp.get('tasks', [])

            if not ecs_tasks:
                # Tasks not found — likely expired (ECS only keeps stopped tasks for 1 hour)
                logger.warning(f"[Reconciler] AppID={app_id} Task={task_id} — ECS tasks not found (expired?), marking FAILED")
                _update_task_status(table, task_id, 'failed', error='ECS task not found — may have expired')
                results['marked_failed'] += 1
                results['reconciled'] += 1
                continue

            # Check if any are still running
            running = [t for t in ecs_tasks if t.get('lastStatus') == 'RUNNING']
            stopped = [t for t in ecs_tasks if t.get('lastStatus') == 'STOPPED']

            if running:
                logger.info(f"[Reconciler] AppID={app_id} Task={task_id} — {len(running)} ECS task(s) still RUNNING, leaving alone")
                results['left_running'] += 1
                continue

            # All stopped — check exit codes
            all_success = all(
                t.get('containers', [{}])[0].get('exitCode', 1) == 0
                for t in stopped if t.get('containers')
            )

            if all_success:
                logger.info(f"[Reconciler] AppID={app_id} Task={task_id} — ECS tasks exited successfully, marking COMPLETED")
                _update_task_status(table, task_id, 'completed')
                results['marked_completed'] += 1
                results['reconciled'] += 1

                # Trigger assessment extraction if results exist on S3
                _trigger_assessment_extraction(task_id, app_id, run_id, task_type, task)
            else:
                # Get error from stopped container
                failed_tasks = [t for t in stopped if t.get('containers', [{}])[0].get('exitCode', 0) != 0]
                error_reason = ''
                if failed_tasks:
                    container = failed_tasks[0].get('containers', [{}])[0]
                    error_reason = container.get('reason', '') or f"Exit code: {container.get('exitCode', '?')}"
                    stopped_reason = failed_tasks[0].get('stoppedReason', '')
                    if stopped_reason:
                        error_reason = f"{error_reason} ({stopped_reason})"

                logger.warning(f"[Reconciler] AppID={app_id} Task={task_id} — ECS tasks FAILED: {error_reason}")
                _update_task_status(table, task_id, 'failed', error=error_reason or 'ECS task failed')
                results['marked_failed'] += 1
                results['reconciled'] += 1

        except Exception as e:
            logger.error(f"[Reconciler] Failed to check ECS status for task {task_id}: {e}")

    logger.info(
        f"[Reconciler] Done: {results['reconciled']} reconciled, "
        f"{results['left_running']} still running, "
        f"{results['marked_completed']} completed, "
        f"{results['marked_failed']} failed"
    )
    return {'success': True, 'total_in_progress': len(in_progress), **results}


def _update_task_status(table, task_id: str, status: str, error: str = '') -> None:
    """Update task status in DynamoDB."""
    try:
        update_expr = 'SET #s = :s, updated_at = :u'
        expr_values: Dict[str, Any] = {':s': status, ':u': datetime.now().isoformat()}
        expr_names = {'#s': 'status'}
        if error:
            update_expr += ', #e = :e'
            expr_values[':e'] = error
            expr_names['#e'] = 'error'
        table.update_item(
            Key={'task_id': task_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
    except Exception as e:
        logger.error(f"[Reconciler] Failed to update task {task_id}: {e}")


def _trigger_assessment_extraction(task_id: str, app_id: str, run_id: str,
                                    task_type: str, task: Dict[str, Any]) -> None:
    """Trigger assessment extraction for a completed task."""
    try:
        if task_type == 'atx_transform':
            from app.strands.tools.atx.extract_atx_transformation import extract_atx_transformation
            transformations = task.get('transformations', [])
            if transformations:
                result = extract_atx_transformation(task_id, app_id, run_id, transformations)
                logger.info(f"[Reconciler] Transform extraction for {task_id}: {result.get('extracted', 0)} steps")
        else:
            # Code analysis — extract per-repo assessments
            from app.services.atx_assessment_service import ATXAssessmentService
            svc = ATXAssessmentService()
            repo_statuses = task.get('repo_statuses', {})
            for repo_name, status_info in repo_statuses.items():
                repo_status = status_info.get('status', '') if isinstance(status_info, dict) else status_info
                if repo_status == 'completed':
                    s3_prefix = f"atx-results/{app_id}/{run_id}_{repo_name}"
                    try:
                        result = svc.process_atx_results(app_id, run_id, repo_name, s3_prefix)
                        logger.info(f"[Reconciler] Assessment extracted for {repo_name}: {result.get('success')}")
                    except Exception as e:
                        logger.error(f"[Reconciler] Assessment extraction failed for {repo_name}: {e}")
    except Exception as e:
        logger.error(f"[Reconciler] Assessment extraction failed for task {task_id}: {e}")
