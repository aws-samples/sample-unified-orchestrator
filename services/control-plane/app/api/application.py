"""Application and wave management API endpoints — reads directly from DynamoDB."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.utils.auth import User, get_current_user, get_accessible_app_ids
from app.repositories.application_repository import (
    ApplicationRepository,
    get_application_repository,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/wave", tags=["wave"])


@router.get("/applications/slim")
def get_wave_applications_slim(
    user: User = Depends(get_current_user),
    app_repo: ApplicationRepository = Depends(get_application_repository),
):
    """Return all applications with minimal fields plus wave distribution."""
    try:
        all_apps = app_repo.get_all_applications()

        # POD-scoped filtering: restrict to accessible apps for POD-restricted personas
        allowed = get_accessible_app_ids(user)
        if allowed is not None:
            all_apps = [a for a in all_apps if a.get("application_id") in allowed]

        wave_dist: dict[str, int] = {}
        for app in all_apps:
            wave = app.get("WAVE") or "unassigned"
            wave_dist[wave] = wave_dist.get(wave, 0) + 1

        return {"success": True, "data": {"applications": all_apps, "wave_distribution": wave_dist}}
    except Exception as e:
        logger.exception("Error in get_applications_slim")
        return JSONResponse(content={"success": False, "error": "Internal server error"}, status_code=500)


@router.get("/applications/paginated")
def get_wave_applications_paginated(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
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

        # POD-scoped filtering: restrict to accessible apps for POD-restricted personas
        allowed = get_accessible_app_ids(user)
        if allowed is not None:
            all_apps = [a for a in all_apps if a.get("application_id") in allowed]

        filtered = all_apps

        if exclude_unassigned and exclude_unassigned.lower() == "true":
            filtered = [a for a in filtered if (a.get("WAVE") or "").strip() and a.get("WAVE") != "unassigned"]

        if wave:
            filtered = [a for a in filtered if a.get("WAVE") == wave]

        if name:
            name_lower = name.lower()
            filtered = [a for a in filtered if name_lower in (a.get("application_name") or "").lower() or name_lower in (a.get("application_id") or "").lower()]

        if risk_assessment_status:
            filtered = [a for a in filtered if a.get("risk_assessment_status") == risk_assessment_status]

        if wave_analysis_status:
            filtered = [a for a in filtered if a.get("wave_analysis_status") == wave_analysis_status]

        if atx_mapping_status:
            filtered = [a for a in filtered if a.get("atx_mapping_status") == atx_mapping_status]

        total_count = len(filtered)
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        start = (page - 1) * page_size
        page_items = filtered[start : start + page_size]

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
        return JSONResponse(content={"success": False, "error": "Internal server error"}, status_code=500)


@router.get("/applications")
def get_wave_applications(
    request: Request,
    user: User = Depends(get_current_user),
    app_repo: ApplicationRepository = Depends(get_application_repository),
):
    """Return all applications with wave distribution (used by RiskDashboard)."""
    try:
        all_apps = app_repo.get_all_applications()

        # POD-scoped filtering: restrict to accessible apps for POD-restricted personas
        allowed = get_accessible_app_ids(user)
        if allowed is not None:
            all_apps = [a for a in all_apps if a.get("application_id") in allowed]

        wave_dist: dict[str, int] = {}
        for app in all_apps:
            wave = app.get("WAVE") or "unassigned"
            wave_dist[wave] = wave_dist.get(wave, 0) + 1

        return {
            "success": True,
            "data": {
                "total_applications": len(all_apps),
                "wave_distribution": wave_dist,
                "applications": all_apps,
            },
        }
    except Exception as e:
        logger.exception("Error in get_wave_applications")
        return JSONResponse(content={"success": False, "error": "Internal server error"}, status_code=500)


@router.get("/{wave_id}/applications/status-summary")
def get_wave_status_summary(
    wave_id: str,
    user: User = Depends(get_current_user),
    app_repo: ApplicationRepository = Depends(get_application_repository),
):
    """Get application status summary for a wave."""
    try:
        all_apps = app_repo.get_all_applications()
        wave_apps = [a for a in all_apps if a.get("WAVE") == wave_id]

        summary = {
            "wave_id": wave_id,
            "total_applications": len(wave_apps),
            "risk_assessment": {"NOT_STARTED": 0, "IN_PROGRESS": 0, "COMPLETED": 0},
            "wave_analysis": {"NOT_STARTED": 0, "IN_PROGRESS": 0, "COMPLETED": 0},
            "atx_mapping": {"NOT_MAPPED": 0, "MAPPED": 0, "COMPLETED": 0},
        }
        for app in wave_apps:
            rs = app.get("risk_assessment_status", "NOT_STARTED")
            if rs in summary["risk_assessment"]:
                summary["risk_assessment"][rs] += 1
            ws = app.get("wave_analysis_status", "NOT_STARTED")
            if ws in summary["wave_analysis"]:
                summary["wave_analysis"][ws] += 1
            atx = app.get("atx_mapping_status", "NOT_MAPPED")
            if atx in summary["atx_mapping"]:
                summary["atx_mapping"][atx] += 1

        return {"success": True, "data": summary}
    except Exception as e:
        logger.exception("Error in get_wave_status_summary")
        return JSONResponse(content={"success": False, "error": "Internal server error"}, status_code=500)
