"""PAM API service for external integration."""
import httpx
from typing import Dict, Any, List, Optional
import logging
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger(__name__)


class PAMService:
    """Service for external PAM API integration."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
    ):
        self.client = client
        self.max_retries = max_retries
        self.retry_backoff = retry_backoff

    async def health_check(self) -> Dict[str, Any]:
        """Check PAM API health status."""
        try:
            response = await self.client.get("/health")
            response.raise_for_status()
            logger.info("PAM API health check successful")
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"PAM API health check failed: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def list_applications(
        self,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """List applications with optional filtering."""
        params = filters or {}
        try:
            response = await self.client.get("/applications", params=params)
            response.raise_for_status()
            data = response.json()
            logger.info(f"Listed {len(data)} applications")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error listing applications: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_application(self, app_id: str) -> Dict[str, Any]:
        """Get application metadata by ID."""
        try:
            response = await self.client.get(f"/applications/{app_id}")
            response.raise_for_status()
            logger.info(f"Retrieved application: {app_id}")
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Error getting application {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_complexity_score(self, app_id: str) -> Dict[str, Any]:
        """Get complexity score for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/complexity")
            response.raise_for_status()
            logger.info(f"Retrieved complexity score for application: {app_id}")
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Error getting complexity score for {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def sync_applications(self) -> Dict[str, Any]:
        """Trigger application synchronization (privileged operation)."""
        try:
            response = await self.client.post("/sync")
            response.raise_for_status()
            logger.info("Application sync triggered successfully")
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Error triggering sync: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def search_applications(self, query: str) -> List[Dict[str, Any]]:
        """Search applications by query string."""
        try:
            response = await self.client.get("/search", params={"q": query})
            response.raise_for_status()
            data = response.json()
            logger.info(f"Search returned {len(data)} results for query: {query}")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error searching applications: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_servers(self, app_id: str) -> List[Dict[str, Any]]:
        """Get server list for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/servers")
            response.raise_for_status()
            data = response.json()
            logger.info(f"Retrieved {len(data)} servers for application: {app_id}")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error getting servers for {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_databases(self, app_id: str) -> List[Dict[str, Any]]:
        """Get database list for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/databases")
            response.raise_for_status()
            data = response.json()
            logger.info(f"Retrieved {len(data)} databases for application: {app_id}")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error getting databases for {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_contacts(self, app_id: str) -> List[Dict[str, Any]]:
        """Get contact list for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/contacts")
            response.raise_for_status()
            data = response.json()
            logger.info(f"Retrieved {len(data)} contacts for application: {app_id}")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error getting contacts for {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_dependencies(self, app_id: str) -> Dict[str, Any]:
        """Get dependency graph for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/dependencies")
            response.raise_for_status()
            logger.info(f"Retrieved dependencies for application: {app_id}")
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Error getting dependencies for {app_id}: {e}", exc_info=True)
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    )
    async def get_environments(self, app_id: str) -> List[Dict[str, Any]]:
        """Get environment list for an application."""
        try:
            response = await self.client.get(f"/applications/{app_id}/environments")
            response.raise_for_status()
            data = response.json()
            logger.info(f"Retrieved {len(data)} environments for application: {app_id}")
            return data
        except httpx.HTTPError as e:
            logger.error(f"Error getting environments for {app_id}: {e}", exc_info=True)
            raise
