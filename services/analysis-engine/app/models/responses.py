"""Pydantic v2 response models for FastAPI endpoints (optional for documentation)."""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    api: Optional[str] = None


class AssessmentResponse(BaseModel):
    """Response model for risk assessment."""
    assessment_id: str
    application_id: Optional[str] = None
    pod_id: Optional[str] = None
    wave_id: Optional[str] = None
    status: str
    assessment_date: float
    s3_report_key: Optional[str] = None


class AssessmentListResponse(BaseModel):
    """Response model for assessment list."""
    success: bool
    assessments: List[Dict[str, Any]]
    count: int


class ErrorResponse(BaseModel):
    """Response model for errors."""
    error: str
    details: Optional[List[Dict[str, str]]] = None
