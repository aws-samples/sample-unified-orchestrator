"""PAM service dependency injection."""
import httpx
from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings


async def get_pam_service(
    settings: Settings = Depends(get_settings),
):
    """Provide PAMService instance scoped to the request lifecycle.

    Creates an httpx.AsyncClient using PAM_API_BASE_URL and PAM_API_TIMEOUT
    from settings. Returns HTTP 503 when PAM_API_BASE_URL is empty.
    """
    if not settings.PAM_API_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PAM service is not configured (PAM_API_BASE_URL is empty)",
        )

    from app.services.pam_service import PAMService

    async with httpx.AsyncClient(
        base_url=settings.PAM_API_BASE_URL,
        timeout=settings.PAM_API_TIMEOUT,
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
    ) as client:
        service = PAMService(
            client=client,
            max_retries=settings.PAM_API_MAX_RETRIES,
            retry_backoff=settings.PAM_API_RETRY_BACKOFF,
        )
        yield service
