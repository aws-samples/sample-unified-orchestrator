"""PAM Pydantic models for request/response validation."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class ApplicationFilters(BaseModel):
    """Query parameters for filtering applications."""

    name: Optional[str] = Field(default=None, description="Filter by application name")
    environment: Optional[str] = Field(default=None, description="Filter by environment")
    status: Optional[str] = Field(default=None, description="Filter by status")
    owner: Optional[str] = Field(default=None, description="Filter by owner")
    limit: Optional[int] = Field(default=100, ge=1, le=1000, description="Maximum number of results")
    offset: Optional[int] = Field(default=0, ge=0, description="Offset for pagination")

    def to_dict(self) -> Dict[str, Any]:
        """Convert filters to dictionary, excluding None values."""
        return {k: v for k, v in self.model_dump().items() if v is not None}


class PAMApplication(BaseModel):
    """Model representing a PAM application."""

    id: str = Field(..., description="Application ID")
    name: str = Field(..., description="Application name")
    environment: Optional[str] = Field(default=None, description="Environment")
    status: Optional[str] = Field(default=None, description="Application status")
    owner: Optional[str] = Field(default=None, description="Application owner")
    description: Optional[str] = Field(default=None, description="Application description")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class ListApplicationsResponse(BaseModel):
    """Response model for listing applications."""

    applications: List[PAMApplication] = Field(..., description="List of applications")
    total: int = Field(..., description="Total number of applications")
    limit: Optional[int] = Field(default=None, description="Result limit")
    offset: Optional[int] = Field(default=None, description="Result offset")


class ApplicationDetailResponse(BaseModel):
    """Response model for application details."""

    id: str = Field(..., description="Application ID")
    name: str = Field(..., description="Application name")
    environment: Optional[str] = Field(default=None, description="Environment")
    status: Optional[str] = Field(default=None, description="Application status")
    owner: Optional[str] = Field(default=None, description="Application owner")
    description: Optional[str] = Field(default=None, description="Application description")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")
    servers: Optional[List[Dict[str, Any]]] = Field(default=None, description="Associated servers")
    databases: Optional[List[Dict[str, Any]]] = Field(default=None, description="Associated databases")
    contacts: Optional[List[Dict[str, Any]]] = Field(default=None, description="Application contacts")


class ComplexityScoreResponse(BaseModel):
    """Response model for complexity score."""

    application_id: str = Field(..., description="Application ID")
    complexity_score: float = Field(..., description="Complexity score")
    factors: Optional[Dict[str, Any]] = Field(default=None, description="Factors contributing to score")


class SyncResponse(BaseModel):
    """Response model for sync operation."""

    status: str = Field(..., description="Sync status")
    message: str = Field(..., description="Status message")
    synced_count: Optional[int] = Field(default=None, description="Number of items synced")
    timestamp: Optional[str] = Field(default=None, description="Sync timestamp")


class HealthResponse(BaseModel):
    """Response model for health check endpoints."""

    status: str = Field(..., description="Health status")
    version: Optional[str] = Field(default=None, description="API version")
    timestamp: Optional[str] = Field(default=None, description="Current timestamp")
