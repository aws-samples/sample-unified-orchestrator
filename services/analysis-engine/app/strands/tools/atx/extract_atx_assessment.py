"""Tool 2: Extract structured assessment from ATXDocumentation using AI."""
import logging
from typing import Dict, Any, List
from app.services.atx_assessment_service import ATXAssessmentService

logger = logging.getLogger(__name__)


def extract_atx_assessment(
    app_id: str,
    run_id: str,
    repo_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Read ATXDocumentation from S3, extract structured data with AI,
    store in DynamoDB.

    Args:
        app_id: Application ID
        run_id: ATX run ID
        repo_results: List of per-repo results from Tool 1
            (each has 'repo_name', 'upload' with 's3_prefix')

    Returns:
        Dict with success and per-repo extraction results
    """
    logger.info(f"[ATX Tool 2] Starting assessment extraction for {app_id}")
    svc = ATXAssessmentService()
    results = []

    for repo in repo_results:
        repo_name = repo.get('repo_name', 'unknown')
        s3_prefix = repo.get('upload', {}).get('s3_prefix', '')

        if not s3_prefix:
            logger.warning(f"[ATX Tool 2] No S3 prefix for {repo_name}, skipping")
            results.append({'repo_name': repo_name, 'success': False,
                          'error': 'No S3 results to extract from'})
            continue

        try:
            result = svc.process_atx_results(app_id, run_id, repo_name, s3_prefix)
            results.append(result)
        except Exception as e:
            logger.error(f"[ATX Tool 2] Failed for {repo_name}: {e}")
            results.append({'repo_name': repo_name, 'success': False,
                          'error': str(e)})

    success_count = sum(1 for r in results if r.get('success'))
    logger.info(f"[ATX Tool 2] Completed: {success_count}/{len(results)} repos extracted")

    return {
        'success': success_count > 0,
        'app_id': app_id,
        'extracted': success_count,
        'total': len(results),
        'results': results
    }
