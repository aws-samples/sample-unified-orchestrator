"""Tool 3: Run ATX transformation pipeline on a single repo."""
import logging
from typing import Dict, Any, List
from app.services.atx_service import ATXService

logger = logging.getLogger(__name__)


def run_atx_transformation(
    task_id: str,
    app_id: str,
    repo_url: str,
    branch: str,
    transformations: List[Dict[str, Any]],
    s3_prefix: str,
    push_to_repo: bool = True,
) -> Dict[str, Any]:
    """
    Run sequential ATX transformations on a single repo.
    Delegates to the transform worker pipeline.

    Args:
        task_id: Processing task ID
        app_id: Application ID
        repo_url: Repository URL
        branch: Branch to checkout/create
        transformations: Ordered list of transformations
        s3_prefix: S3 prefix for results
        push_to_repo: Whether to push after completion
    """
    logger.info(f"[ATX Tool 3] Starting transformation for {app_id} repo={repo_url}")
    from app.workers.atx_transform_worker import run_transform_pipeline
    run_transform_pipeline(task_id)
    logger.info(f"[ATX Tool 3] Completed for {app_id}")
    return {'success': True, 'task_id': task_id}
