"""
Retriever Tool

Retrieves all unique components and repository information for an application.
"""

import logging
from strands import tool
from app.repositories.app_component_repository import AppComponentRepository
from app.repositories.application_repository import ApplicationRepository

logger = logging.getLogger(__name__)

# Lazy repository initialization
_app_component_repo = None
_application_repo = None


def get_app_component_repo():
    """Get or create AppComponentRepository instance."""
    global _app_component_repo
    if _app_component_repo is None:
        _app_component_repo = AppComponentRepository()
    return _app_component_repo


def get_application_repo():
    """Get or create ApplicationRepository instance."""
    global _application_repo
    if _application_repo is None:
        _application_repo = ApplicationRepository()
    return _application_repo


@tool
def retriever(app_id: str) -> dict:
    """
    Retrieve all unique components and repository URLs for an application.

    Fetches:
    - Unique application components (deduplicated by publisher+product+version)
    - Repository URLs from app-wave-application table
    - Application metadata

    Args:
        app_id: Application ID to retrieve data for

    Returns:
        Dictionary containing:
        - unique_components: List of deduplicated components
        - repository_urls: List of repository URLs
        - application_info: Application metadata
        - total_components: Count of unique components
    """
    logger.info(f"Retrieving data for application {app_id}")

    try:
        # Fetch application components
        app_components = get_app_component_repo().get_by_application_id(str(app_id))

        # Deduplicate components - same component can exist on multiple machines
        # Also count unique machines across all components
        unique_components = {}
        unique_machines = set()
        for comp in app_components:
            # Track unique machines
            if comp.computer_name:
                unique_machines.add(comp.computer_name)

            key = f"{comp.software_publisher}#{comp.product}#{comp.full_version}".lower()
            if key not in unique_components:
                unique_components[key] = {
                    'component_id': comp.component_id,
                    'publisher': comp.software_publisher,
                    'product': comp.product,
                    'full_version': comp.full_version,
                    'normalized_version': comp.normalized_version,
                    'category': comp.category,
                    'sub_category': comp.sub_category,
                    'is_licensable': comp.is_licensable,
                    'eosl_status': comp.eosl_status,
                    'eosl_date': comp.eosl_date,
                    'category_group': getattr(comp, 'category_group', 'Unknown'),
                    'computer_name': comp.computer_name,
                }

        components_list = list(unique_components.values())

        # Fetch application info and repository URLs
        try:
            app_info = get_application_repo().get_application(str(app_id))
            repository_urls = []
            if app_info:
                # Try multiple field names (scm_urls, SCM_URLS, repository_url)
                if 'scm_urls' in app_info and app_info['scm_urls']:
                    repository_urls = app_info['scm_urls']
                elif 'SCM_URLS' in app_info and app_info['SCM_URLS']:
                    repository_urls = app_info['SCM_URLS']
                elif 'repository_url' in app_info and app_info['repository_url']:
                    repository_urls = [app_info['repository_url']]
        except Exception as e:
            logger.warning(f"Could not fetch application info: {e}")
            app_info = None
            repository_urls = []

        machine_count = len(unique_machines)
        repo_count = len(repository_urls)
        logger.info(f"Retrieved {len(components_list)} unique components, "
                     f"{machine_count} machines, {repo_count} repos for application {app_id}")

        return {
            'app_id': app_id,
            'unique_components': components_list,
            'repository_urls': repository_urls,
            'application_info': {
                'app_id': app_id,
                'app_name': app_info.get('app_name', f"Application {app_id}") if app_info else f"Application {app_id}",
                'wave_id': app_info.get('wave_id') if app_info else None,
            },
            'total_components': len(components_list),
            'machine_count': machine_count,
            'repo_count': repo_count,
        }

    except Exception as e:
        logger.error(f"Error retrieving data for application {app_id}: {str(e)}")
        return {
            'app_id': app_id,
            'unique_components': [],
            'repository_urls': [],
            'application_info': {'app_id': app_id, 'app_name': f"Application {app_id}"},
            'total_components': 0,
            'machine_count': 0,
            'repo_count': 0,
            'error': str(e)
        }
