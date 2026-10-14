"""Application repository for DynamoDB operations."""
import logging
from typing import Dict, Any, List, Optional

import boto3

from app.config import get_settings

logger = logging.getLogger(__name__)


class ApplicationRepository:
    """Read applications from the control-plane DynamoDB table."""

    def __init__(self):
        settings = get_settings()
        self._dynamodb = boto3.resource("dynamodb", region_name=settings.AWS_REGION)
        self._table = self._dynamodb.Table(settings.APPLICATIONS_TABLE)

    MAX_APPLICATIONS = 10_000  # Hard cap to prevent unbounded memory growth

    def get_all_applications(self) -> List[Dict[str, Any]]:
        """Scan all applications and normalise field names."""
        items: List[Dict[str, Any]] = []
        scan_kwargs: Dict[str, Any] = {"Limit": 1000}
        while True:
            response = self._table.scan(**scan_kwargs)
            for item in response.get("Items", []):
                normalised = {
                    "application_id": item.get("application_id"),
                    "application_name": item.get("APPLICATION_NAME") or item.get("application_name"),
                    "WAVE": item.get("WAVE", ""),
                    "STATUS": item.get("STATUS") or item.get("status", "active"),
                    "scm_urls": item.get("scm_urls") or item.get("SCM_URLS") or [],
                    "risk_assessment_status": item.get("risk_assessment_status", "NOT_STARTED"),
                    "wave_analysis_status": item.get("wave_analysis_status", "NOT_STARTED"),
                    "atx_mapping_status": item.get("atx_mapping_status", "NOT_MAPPED"),
                    "created_at": item.get("created_at"),
                    "updated_at": item.get("updated_at"),
                }
                # Carry over any extra fields
                for key, value in item.items():
                    if key not in normalised:
                        normalised[key] = value
                items.append(normalised)
            if len(items) >= self.MAX_APPLICATIONS:
                logger.warning("Application scan hit max limit of %d, truncating", self.MAX_APPLICATIONS)
                break
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_kwargs["ExclusiveStartKey"] = last_key
        return items

    def get_application(self, app_id: str) -> Optional[Dict[str, Any]]:
        """Get a single application by ID."""
        response = self._table.get_item(Key={"application_id": app_id})
        return response.get("Item")


# Singleton
_repo: Optional[ApplicationRepository] = None


def get_application_repository() -> ApplicationRepository:
    """Return a singleton ApplicationRepository."""
    global _repo
    if _repo is None:
        _repo = ApplicationRepository()
    return _repo
