"""Tool 4: Extract transformation-specific assessment from ATXDocumentation using AI."""
import logging
from typing import Dict, Any, List
from app.services.atx_transformation_assessment_service import ATXTransformationAssessmentService

logger = logging.getLogger(__name__)


def extract_atx_transformation(
    task_id: str,
    app_id: str,
    run_id: str,
    transformations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Read ATXDocumentation from S3 for each completed transformation step,
    extract structured data with AI, store in DynamoDB.

    Args:
        task_id: Processing task ID
        app_id: Application ID
        run_id: Transformation run ID
        transformations: List of transformation records with result_s3_prefix
    """
    logger.info(f"[ATX Tool 4] Starting transformation extraction for {app_id}")
    svc = ATXTransformationAssessmentService()
    results = []

    for t in transformations:
        idx = t.get('order', 0)
        name = t.get('name', 'unknown')
        s3_prefix = t.get('result_s3_prefix', '')
        status = t.get('status', '')

        if status != 'completed' or not s3_prefix:
            logger.info(f"[ATX Tool 4] Skipping step {idx} ({name}): status={status}")
            results.append({'step': idx, 'name': name, 'success': False, 'reason': 'not completed'})
            continue

        try:
            result = svc.process_transformation_results(task_id, app_id, run_id, name, idx, s3_prefix)
            results.append({**result, 'step': idx, 'name': name})
        except Exception as e:
            logger.error(f"[ATX Tool 4] Failed for step {idx}: {e}")
            results.append({'step': idx, 'name': name, 'success': False, 'error': str(e)})

    success_count = sum(1 for r in results if r.get('success'))
    logger.info(f"[ATX Tool 4] Completed: {success_count}/{len(results)} steps extracted")

    return {
        'success': success_count > 0,
        'task_id': task_id,
        'app_id': app_id,
        'extracted': success_count,
        'total': len(results),
        'results': results
    }
