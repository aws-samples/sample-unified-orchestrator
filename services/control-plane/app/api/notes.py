"""Notes API router for file upload and management."""
import logging
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, status
from urllib.parse import unquote

from app.models.notes_models import (
    NoteUploadResponse,
    NoteListResponse,
    DownloadUrlResponse,
    DeleteResponse,
    NoteTypesResponse,
    ProcessingStatusResponse,
    ProcessingTasksResponse,
)
from app.services.notes_service import NotesService
from app.config import get_settings
from app.utils.auth import User, get_current_user, get_accessible_app_ids

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/notes", tags=["Notes"])


def get_notes_service() -> NotesService:
    """Dependency to get NotesService instance."""
    settings = get_settings()
    return NotesService(s3_bucket=settings.S3_UNO_DP_BUCKET, region=settings.AWS_REGION)


@router.post(
    "/upload",
    response_model=NoteUploadResponse,
    status_code=status.HTTP_200_OK,
    summary="Upload a note file",
    description="Upload a note file to S3 and optionally trigger processing",
)
async def upload_note(
    file: UploadFile = File(...),
    note_type: str = Form(...),
    application_name: str = Form(default="ALL"),
    application_id: Optional[str] = Form(default=None),
    os_type: Optional[str] = Form(default=None),
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> NoteUploadResponse:
    """Upload a note file to S3."""
    try:
        result = await service.upload_note(
            file, note_type, application_name, os_type, current_user.email, application_id
        )
        return NoteUploadResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in upload endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/list",
    response_model=NoteListResponse,
    status_code=status.HTTP_200_OK,
    summary="List uploaded notes",
    description="List all uploaded notes with optional filtering",
)
async def list_notes(
    note_type: Optional[str] = None,
    application_name: Optional[str] = None,
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> NoteListResponse:
    """List all uploaded notes, filtered by POD access."""
    try:
        result = await service.list_notes(note_type, application_name)

        # POD-scoped filtering: only show global notes + notes for accessible apps
        allowed = get_accessible_app_ids(current_user)
        if allowed is not None and 'notes' in result:
            result['notes'] = [
                n for n in result['notes']
                if n.get('application_name') in ('ALL', 'Unknown')
                or n.get('application_id') in allowed
                or n.get('application_name') in allowed
            ]

        return NoteListResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in list endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/download/{file_key:path}",
    response_model=DownloadUrlResponse,
    status_code=status.HTTP_200_OK,
    summary="Get download URL",
    description="Generate a presigned URL for downloading a note",
)
async def download_note(
    file_key: str,
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> DownloadUrlResponse:
    """Generate a presigned URL for downloading a note."""
    try:
        decoded_key = unquote(file_key)
        if '..' in decoded_key or not decoded_key.startswith('notes/'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file key")
        result = await service.get_download_url(decoded_key)
        return DownloadUrlResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in download endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete(
    "/delete/{file_key:path}",
    response_model=DeleteResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete a note",
    description="Delete a note from S3 and associated data",
)
async def delete_note(
    file_key: str,
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> DeleteResponse:
    """Delete a note from S3 (privileged operation)."""
    try:
        decoded_key = unquote(file_key)
        if '..' in decoded_key or not decoded_key.startswith('notes/'):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file key")
        result = await service.delete_note(decoded_key)
        return DeleteResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in delete endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/types",
    response_model=NoteTypesResponse,
    status_code=status.HTTP_200_OK,
    summary="Get note types",
    description="Get available note types with their allowed file extensions",
)
async def get_note_types(
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> NoteTypesResponse:
    """Get available note types."""
    try:
        result = service.get_note_types()
        return NoteTypesResponse(**result)
    except Exception as e:
        logger.error(f"Error in types endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/processing-status/{task_id}",
    response_model=ProcessingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get processing status",
    description="Get status of a processing task",
)
async def get_processing_status(
    task_id: str,
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> ProcessingStatusResponse:
    """Get status of a processing task."""
    try:
        task = await service.get_processing_task(task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        return ProcessingStatusResponse(success=True, task=task)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in processing-status endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/processing-tasks",
    response_model=ProcessingTasksResponse,
    status_code=status.HTTP_200_OK,
    summary="List processing tasks",
    description="List all processing tasks",
)
async def get_processing_tasks(
    limit: int = 100,
    service: NotesService = Depends(get_notes_service),
    current_user: User = Depends(get_current_user),
) -> ProcessingTasksResponse:
    """List all processing tasks."""
    try:
        tasks = await service.list_processing_tasks(limit)
        return ProcessingTasksResponse(success=True, tasks=tasks, count=len(tasks))
    except Exception as e:
        logger.error(f"Error in processing-tasks endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
