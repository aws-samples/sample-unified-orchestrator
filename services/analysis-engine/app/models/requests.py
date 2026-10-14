"""Pydantic v2 request models for FastAPI endpoints."""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator


class ReadinessInputs(BaseModel):
    """Combined readiness inputs (team + business)."""
    # Team readiness
    team_availability: Optional[str] = None
    skill_level: Optional[str] = None
    knowledge_transfer: Optional[str] = None
    training_completed: Optional[str] = None

    # Business readiness
    maintenance_window: Optional[str] = None
    business_calendar: Optional[str] = None
    stakeholder_alignment: Optional[str] = None
    budget_availability: Optional[str] = None


class TeamReadinessInputs(BaseModel):
    """Team readiness assessment inputs."""
    team_availability: Optional[str] = None
    skill_level: Optional[str] = None
    knowledge_transfer: Optional[str] = None
    training_completed: Optional[str] = None


class BusinessReadinessInputs(BaseModel):
    """Business readiness assessment inputs."""
    maintenance_window: Optional[str] = None
    business_calendar: Optional[str] = None
    stakeholder_alignment: Optional[str] = None
    budget_availability: Optional[str] = None


class RiskAssessmentRequest(BaseModel):
    """Request model for risk assessment."""
    application_id: Optional[str] = None
    pod_id: Optional[str] = None
    wave_id: Optional[str] = None

    # Support both formats
    readiness_inputs: Optional[ReadinessInputs] = None
    team_readiness_inputs: Optional[TeamReadinessInputs] = None
    business_readiness_inputs: Optional[BusinessReadinessInputs] = None

    @model_validator(mode='after')
    def validate_entity_id(self):
        """Ensure exactly one entity ID is provided."""
        ids = [self.application_id, self.pod_id, self.wave_id]
        provided = [x for x in ids if x is not None]
        if len(provided) != 1:
            raise ValueError('Exactly one of application_id, pod_id, or wave_id must be provided')
        return self


class ParallelAssessmentRequest(BaseModel):
    """Request model for parallel risk assessment."""
    application_ids: List[str] = Field(..., min_length=1)
    max_workers: Optional[int] = Field(default=5, ge=1, le=20)

    # Support both formats
    readiness_inputs: Optional[ReadinessInputs] = None
    team_readiness_inputs: Optional[TeamReadinessInputs] = None
    business_readiness_inputs: Optional[BusinessReadinessInputs] = None


class WavePatternAnalysisRequest(BaseModel):
    """Request model for wave pattern analysis."""
    similarity_threshold: Optional[int] = Field(default=70, ge=0, le=100)


class ATXMapping(BaseModel):
    """Single ATX mapping entry."""
    pattern_id: str
    application_id: str
    application_name: str
    strategy: Optional[str] = None
    transformation_instructions: Optional[str] = None
    atx_name: str
    atx_description: Optional[str] = None


class ATXMappingSubmission(BaseModel):
    """Request model for ATX mapping submission."""
    mappings: List[ATXMapping] = Field(..., min_length=1)


class ApplicationStatusUpdateRequest(BaseModel):
    """Request model for application status update."""
    field: str
    status: str


class BulkApplicationRequest(BaseModel):
    """Request model for bulk application operations."""
    application_ids: List[str] = Field(..., min_length=1)
