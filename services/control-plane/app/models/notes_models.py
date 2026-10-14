"""Pydantic models for notes API request/response validation."""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime


# Request Models

class NoteUploadRequest(BaseModel):
    """Request model for note upload (form data)."""
    note_type: Literal["Approved Target Version", "Default OS components", "Architecture Decision", "ATX"]
    application_name: str = Field(default="ALL")
    os_type: Optional[Literal["Rocky Linux", "Ubuntu", "HP-UX", "AIX", "Solaris", "Red Hat Enterprise Linux", "CentOS"]] = None

    @field_validator('os_type')
    @classmethod
    def validate_os_type(cls, v, info):
        """Validate os_type is provided when note_type is Default OS components."""
        if info.data.get('note_type') == 'Default OS components' and not v:
            raise ValueError('os_type is required for Default OS components')
        return v


class NoteListRequest(BaseModel):
    """Request model for listing notes."""
    note_type: Optional[str] = None
    application_name: Optional[str] = None


class ProcessingTasksRequest(BaseModel):
    """Request model for listing processing tasks."""
    limit: int = Field(default=100, ge=1, le=1000)


# Response Models

class NoteUploadData(BaseModel):
    """Data model for upload response."""
    file_key: str
    bucket: str
    note_type: str
    application_name: str
    filename: str
    processing_task_id: Optional[str] = None
    processing_status: Optional[str] = None


class NoteUploadResponse(BaseModel):
    """Response model for note upload."""
    success: bool
    message: str
    data: NoteUploadData


class NoteItem(BaseModel):
    """Model for a single note item."""
    file_key: str
    filename: str
    size: int
    last_modified: str
    note_type: str
    application_name: str
    os_type: Optional[str] = None
    processing_status: Optional[str] = None
    processing_task_id: Optional[str] = None
    conflicts_count: Optional[int] = None
    stored_count: Optional[int] = None
    marked_count: Optional[int] = None
    total_records: Optional[int] = None


class NoteListResponse(BaseModel):
    """Response model for listing notes."""
    success: bool
    notes: List[NoteItem]
    count: int


class DownloadUrlResponse(BaseModel):
    """Response model for download URL."""
    success: bool
    download_url: str


class DeleteResponse(BaseModel):
    """Response model for delete operation."""
    success: bool
    message: str
    deleted_components: int = 0


class NoteTypesResponse(BaseModel):
    """Response model for note types."""
    success: bool
    note_types: List[str]
    file_extensions: Dict[str, List[str]]


class ConflictDifference(BaseModel):
    """Model for field-level conflict differences."""
    existing: str
    new: str


class Conflict(BaseModel):
    """Model for a component conflict."""
    component_id: str
    publisher: str
    product_key: str
    full_version: str
    conflict_type: str
    existing: Dict[str, Any]
    new: Dict[str, Any]
    differences: Dict[str, ConflictDifference]


class ProcessingTask(BaseModel):
    """Model for a processing task."""
    task_id: str
    status: str
    file_key: str
    application_name: str
    created_at: str
    updated_at: str
    created_by: Optional[str] = None
    stored_count: Optional[int] = None
    failed_count: Optional[int] = None
    conflicts_count: Optional[int] = None
    conflicts: Optional[List[Conflict]] = None


class ProcessingStatusResponse(BaseModel):
    """Response model for processing status."""
    success: bool
    task: ProcessingTask


class ProcessingTasksResponse(BaseModel):
    """Response model for listing processing tasks."""
    success: bool
    tasks: List[ProcessingTask]
    count: int


class DefaultOSComponent(BaseModel):
    """Model for a default OS component."""
    component_id: str
    application_name: str
    file_key: str
    product: Optional[str] = None
    publisher: Optional[str] = None
    version: Optional[str] = None
    original_name: Optional[str] = None
    os_type: Optional[str] = None
    created_at: Optional[str] = None


class DefaultOSVersionsResponse(BaseModel):
    """Response model for listing default OS versions."""
    success: bool
    components: List[DefaultOSComponent]
    count: int
