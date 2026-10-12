"""Wave / application listing API endpoints."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query

from app.repositories.application_repository import ApplicationRepository
from app.dependencies import get_application_repository
from app.utils.auth import User, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/ara/wave",
    tags=["Wave Applications"]
)


@router.get("/applications/slim")
async def get_applications_slim(
    user: User = Depends(get_current_user),
    app_repo: ApplicationRepository = Depends(get_application_repository),
):
    """Return all applications with minimal fields plus wave distribution."""
    try:
        all_apps = app_repo.get_all_applications()

        # Build wave distribution
        wave_dist: dict[str, int] = {}
        for app in all_apps:
            wave = app.get("WAVE") or "unassigned"
            wave_dist[wave] = wave_dist.get(wave, 0) + 1

        return {
            "success": True,
            "data": {
                "applications": all_apps,
                "wave_distribution": wave_dist,
            },
        }
    except Exception as e:
        logger.exception("Error in get_applications_slim")
        return {"success": False, "error": str(e)}


@router.get("/applications/paginated")
async def get_applications_paginated(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    wave: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    risk_assessment_status: Optional[str] = Query(None),
    wave_analysis_status: Optional[str] = Query(None),
    atx_mapping_status: Optional[str] = Query(None),
    exclude_unassigned: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    app_repo: ApplicationRepository = Depends(get_application_repository),
):
    """Return a paginated, filterable list of applications."""
    try:
        all_apps = app_repo.get_all_applications()

        # Apply filters
        filtered = all_apps

        if exclude_unassigned and exclude_unassigned.lower() == "true":
            filtered = [
                a for a in filtered
                if (a.get("WAVE") or "").strip() and a.get("WAVE") != "unassigned"
            ]

        if wave:
            filtered = [a for a in filtered if a.get("WAVE") == wave]

        if name:
            name_lower = name.lower()
            filtered = [
                a for a in filtered
                if name_lower in (a.get("application_name") or "").lower()
            ]

        if risk_assessment_status:
            filtered = [
                a for a in filtered
                if a.get("risk_assessment_status") == risk_assessment_status
            ]

        if wave_analysis_status:
            filtered = [
                a for a in filtered
                if a.get("wave_analysis_status") == wave_analysis_status
            ]

        if atx_mapping_status:
            filtered = [
                a for a in filtered
                if a.get("atx_mapping_status") == atx_mapping_status
            ]

        # Paginate
        total_count = len(filtered)
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        start = (page - 1) * page_size
        end = start + page_size
        page_items = filtered[start:end]

        return {
            "success": True,
            "applications": page_items,
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    except Exception as e:
        logger.exception("Error in get_applications_paginated")
        return {"success": False, "error": str(e)}
