"""Tool 1: Run ATX CLI analysis on application repos."""
import logging
from typing import Dict, Any, List
from app.services.atx_service import ATXService

logger = logging.getLogger(__name__)


def run_atx_analysis(
    app_id: str,
    selected_files: List[str] = None,
    selected_repos: List[str] = None
) -> Dict[str, Any]:
    """
    Clone repos, prepare context, run ATX CLI, upload results to S3.

    Args:
        app_id: Application ID
        selected_files: List of S3 keys for context files
        selected_repos: List of repo URLs to analyze (subset). If None, all SCM_URLS.
    """
    logger.info(f"[ATX Tool 1] Starting ATX analysis for {app_id}")
    svc = ATXService()

    if selected_files is None:
        selected_files = [f['key'] for f in svc.get_relevant_files(app_id)]
        logger.info(f"[ATX Tool 1] Auto-selected {len(selected_files)} context files")

    result = svc.run_analysis(app_id, selected_files, selected_repos)
    logger.info(f"[ATX Tool 1] Completed for {app_id}: success={result.get('success')}")
    return result
