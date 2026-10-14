"""PAM integration endpoints."""
from fastapi import APIRouter, Depends, status, HTTPException, Query
from typing import Optional, List, Dict, Any
import logging
import httpx

from app.utils.auth import User, get_current_user
from app.dependencies.pam import get_pam_service
from app.models.pam_models import (
    ApplicationFilters,
    HealthResponse,
    ListApplicationsResponse,
    ApplicationDetailResponse,
    ComplexityScoreResponse,
    SyncResponse,
    PAMApplication,
)
from app.services.pam_service import PAMService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/pam", tags=["PAM"])


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="PAM service health check",
)
async def pam_health_check(
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> HealthResponse:
    """Check PAM service health."""
    logger.info(f"PAM health check by user {current_user.user_id}")
    try:
        health_data = await pam_service.health_check()
        return HealthResponse(
            status=health_data.get("status", "unknown"),
            version=health_data.get("version"),
            timestamp=health_data.get("timestamp"),
        )
    except httpx.HTTPError as e:
        logger.error(f"PAM health check failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PAM service is unavailable",
        )


@router.get(
    "/applications",
    response_model=ListApplicationsResponse,
    status_code=status.HTTP_200_OK,
    summary="List applications",
)
async def list_applications(
    name: Optional[str] = Query(default=None, description="Filter by application name"),
    environment: Optional[str] = Query(default=None, description="Filter by environment"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status"),
    owner: Optional[str] = Query(default=None, description="Filter by owner"),
    limit: int = Query(default=100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(default=0, ge=0, description="Offset for pagination"),
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> ListApplicationsResponse:
    """List applications with filtering."""
    logger.info(f"List applications by user {current_user.user_id}")
    filters = ApplicationFilters(
        name=name, environment=environment, status=status_filter,
        owner=owner, limit=limit, offset=offset,
    )
    try:
        apps_data = await pam_service.list_applications(filters=filters.to_dict())
        applications = [
            PAMApplication(
                id=app.get("id", ""), name=app.get("name", ""),
                environment=app.get("environment"), status=app.get("status"),
                owner=app.get("owner"), description=app.get("description"),
                metadata=app.get("metadata"),
            )
            for app in apps_data
        ]
        return ListApplicationsResponse(
            applications=applications, total=len(applications),
            limit=limit, offset=offset,
        )
    except httpx.HTTPError as e:
        logger.error(f"Error listing applications: {e}", exc_info=True)
        if isinstance(e, httpx.HTTPStatusError):
            raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


@router.get(
    "/applications/{app_id}",
    response_model=ApplicationDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get application details",
)
async def get_application(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> ApplicationDetailResponse:
    """Get application details."""
    logger.info(f"Get application {app_id} by user {current_user.user_id}")
    try:
        app_data = await pam_service.get_application(app_id)
        return ApplicationDetailResponse(
            id=app_data.get("id", app_id), name=app_data.get("name", ""),
            environment=app_data.get("environment"), status=app_data.get("status"),
            owner=app_data.get("owner"), description=app_data.get("description"),
            metadata=app_data.get("metadata"), servers=app_data.get("servers"),
            databases=app_data.get("databases"), contacts=app_data.get("contacts"),
        )
    except httpx.HTTPError as e:
        logger.error(f"Error getting application {app_id}: {e}", exc_info=True)
        if isinstance(e, httpx.HTTPStatusError):
            if e.response.status_code == 404:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Application {app_id} not found")
            raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


@router.get(
    "/applications/{app_id}/complexity",
    response_model=ComplexityScoreResponse,
    status_code=status.HTTP_200_OK,
    summary="Get complexity score",
)
async def get_complexity_score(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> ComplexityScoreResponse:
    """Get application complexity score."""
    logger.info(f"Get complexity score for {app_id} by user {current_user.user_id}")
    try:
        score_data = await pam_service.get_complexity_score(app_id)
        return ComplexityScoreResponse(
            application_id=app_id,
            complexity_score=score_data.get("complexity_score", 0.0),
            factors=score_data.get("factors"),
        )
    except httpx.HTTPError as e:
        logger.error(f"Error getting complexity score for {app_id}: {e}", exc_info=True)
        if isinstance(e, httpx.HTTPStatusError):
            if e.response.status_code == 404:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Application {app_id} not found")
            raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


@router.post(
    "/sync",
    response_model=SyncResponse,
    status_code=status.HTTP_200_OK,
    summary="Sync applications",
)
async def sync_applications(
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> SyncResponse:
    """Trigger application sync (privileged operation)."""
    logger.info(f"Sync applications by user {current_user.user_id}")
    try:
        sync_data = await pam_service.sync_applications()
        return SyncResponse(
            status=sync_data.get("status", "completed"),
            message=sync_data.get("message", "Sync completed successfully"),
            synced_count=sync_data.get("synced_count"),
            timestamp=sync_data.get("timestamp"),
        )
    except httpx.HTTPError as e:
        logger.error(f"Error syncing applications: {e}", exc_info=True)
        if isinstance(e, httpx.HTTPStatusError):
            raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


@router.get(
    "/search",
    response_model=ListApplicationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Search applications",
)
async def search_applications(
    q: str = Query(..., min_length=1, description="Search query"),
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> ListApplicationsResponse:
    """Search applications by query string."""
    logger.info(f"Search applications with query '{q}' by user {current_user.user_id}")
    try:
        apps_data = await pam_service.search_applications(q)
        applications = [
            PAMApplication(
                id=app.get("id", ""), name=app.get("name", ""),
                environment=app.get("environment"), status=app.get("status"),
                owner=app.get("owner"), description=app.get("description"),
                metadata=app.get("metadata"),
            )
            for app in apps_data
        ]
        return ListApplicationsResponse(applications=applications, total=len(applications))
    except httpx.HTTPError as e:
        logger.error(f"Error searching applications: {e}", exc_info=True)
        if isinstance(e, httpx.HTTPStatusError):
            raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


def _handle_pam_error(e: httpx.HTTPError, app_id: str, resource: str):
    """Common error handler for PAM resource endpoints."""
    if isinstance(e, httpx.HTTPStatusError):
        if e.response.status_code == 404:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Application {app_id} not found")
        raise HTTPException(status_code=e.response.status_code, detail="Upstream service error")
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PAM service is unavailable")


@router.get(
    "/applications/{app_id}/servers",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="Get application servers",
)
async def get_application_servers(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> List[Dict[str, Any]]:
    """Get servers for an application."""
    logger.info(f"Get servers for application {app_id} by user {current_user.user_id}")
    try:
        return await pam_service.get_servers(app_id)
    except httpx.HTTPError as e:
        logger.error(f"Error getting servers for {app_id}: {e}", exc_info=True)
        _handle_pam_error(e, app_id, "servers")


@router.get(
    "/applications/{app_id}/databases",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="Get application databases",
)
async def get_application_databases(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> List[Dict[str, Any]]:
    """Get databases for an application."""
    logger.info(f"Get databases for application {app_id} by user {current_user.user_id}")
    try:
        return await pam_service.get_databases(app_id)
    except httpx.HTTPError as e:
        logger.error(f"Error getting databases for {app_id}: {e}", exc_info=True)
        _handle_pam_error(e, app_id, "databases")


@router.get(
    "/applications/{app_id}/contacts",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="Get application contacts",
)
async def get_application_contacts(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> List[Dict[str, Any]]:
    """Get contacts for an application."""
    logger.info(f"Get contacts for application {app_id} by user {current_user.user_id}")
    try:
        return await pam_service.get_contacts(app_id)
    except httpx.HTTPError as e:
        logger.error(f"Error getting contacts for {app_id}: {e}", exc_info=True)
        _handle_pam_error(e, app_id, "contacts")


@router.get(
    "/applications/{app_id}/dependencies",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="Get application dependencies",
)
async def get_application_dependencies(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> List[Dict[str, Any]]:
    """Get dependencies for an application."""
    logger.info(f"Get dependencies for application {app_id} by user {current_user.user_id}")
    try:
        return await pam_service.get_dependencies(app_id)
    except httpx.HTTPError as e:
        logger.error(f"Error getting dependencies for {app_id}: {e}", exc_info=True)
        _handle_pam_error(e, app_id, "dependencies")


@router.get(
    "/applications/{app_id}/environments",
    response_model=List[Dict[str, Any]],
    status_code=status.HTTP_200_OK,
    summary="Get application environments",
)
async def get_application_environments(
    app_id: str,
    current_user: User = Depends(get_current_user),
    pam_service: PAMService = Depends(get_pam_service),
) -> List[Dict[str, Any]]:
    """Get environments for an application."""
    logger.info(f"Get environments for application {app_id} by user {current_user.user_id}")
    try:
        return await pam_service.get_environments(app_id)
    except httpx.HTTPError as e:
        logger.error(f"Error getting environments for {app_id}: {e}", exc_info=True)
        _handle_pam_error(e, app_id, "environments")
