"""Risk assessment API endpoints - FastAPI version."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query, Path, HTTPException, Response
import botocore.exceptions

from app.models.requests import RiskAssessmentRequest, ParallelAssessmentRequest
from app.services.risk_service import RiskService
from app.dependencies import get_risk_service
from app.utils.auth import User, get_current_user, get_accessible_app_ids
from app.utils.error_response import error_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/ara/risk",
    tags=["Risk Assessment"]
)

_GENERIC_ERROR = 'Internal server error'


@router.post("/assess")
async def assess_risk(
    request: RiskAssessmentRequest,
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Start risk assessment for application, pod, or wave."""
    try:
        # Determine entity type and ID
        if request.application_id:
            entity_type = 'application'
            entity_id = request.application_id
        elif request.pod_id:
            entity_type = 'pod'
            entity_id = request.pod_id
        else:
            entity_type = 'wave'
            entity_id = request.wave_id

        # Extract readiness inputs (support both formats)
        team_readiness = None
        business_readiness = None

        if request.team_readiness_inputs:
            team_readiness = request.team_readiness_inputs.model_dump(exclude_none=True)
        if request.business_readiness_inputs:
            business_readiness = request.business_readiness_inputs.model_dump(exclude_none=True)

        # If combined readiness_inputs provided, split it
        if request.readiness_inputs:
            ri = request.readiness_inputs
            team_fields = ['team_availability', 'skill_level', 'knowledge_transfer', 'training_completed']
            business_fields = ['maintenance_window', 'business_calendar', 'stakeholder_alignment', 'budget_availability']

            team_data = {k: v for k, v in ri.model_dump(exclude_none=True).items() if k in team_fields}
            business_data = {k: v for k, v in ri.model_dump(exclude_none=True).items() if k in business_fields}

            if team_data and not team_readiness:
                team_readiness = team_data
            if business_data and not business_readiness:
                business_readiness = business_data

        # Start assessment
        result = risk_service.assess_risk(
            entity_id,
            entity_type,
            team_readiness_inputs=team_readiness,
            business_readiness_inputs=business_readiness
        )

        return result

    except botocore.exceptions.ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']
        logger.error(f'Bedrock error in assess_risk: {error_code} — {error_msg}')
        status_map = {
            'ThrottlingException': 429,
            'ModelTimeoutException': 408,
            'AccessDeniedException': 403,
        }
        raise HTTPException(
            status_code=status_map.get(error_code, 500),
            detail=error_response(
                status_code=status_map.get(error_code, 500),
                error_type=error_code,
                message=f'AI analysis error: {error_code}. Please try again.',
            )
        )
    except Exception as e:
        logger.exception('Error in assess_risk')
        raise HTTPException(
            status_code=500,
            detail=error_response(
                status_code=500,
                error_type='INTERNAL_ERROR',
                message='An unexpected error occurred during risk assessment.',
            )
        )


@router.post("/assess/parallel")
async def assess_risk_parallel(
    request: ParallelAssessmentRequest,
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Assess multiple applications in parallel."""
    try:
        # Extract readiness inputs (support both formats)
        team_readiness = None
        business_readiness = None

        if request.team_readiness_inputs:
            team_readiness = request.team_readiness_inputs.model_dump(exclude_none=True)
        if request.business_readiness_inputs:
            business_readiness = request.business_readiness_inputs.model_dump(exclude_none=True)

        # If combined readiness_inputs provided, split it
        if request.readiness_inputs:
            ri = request.readiness_inputs
            team_fields = ['team_availability', 'skill_level', 'knowledge_transfer', 'training_completed']
            business_fields = ['maintenance_window', 'business_calendar', 'stakeholder_alignment', 'budget_availability']

            team_data = {k: v for k, v in ri.model_dump(exclude_none=True).items() if k in team_fields}
            business_data = {k: v for k, v in ri.model_dump(exclude_none=True).items() if k in business_fields}

            if team_data and not team_readiness:
                team_readiness = team_data
            if business_data and not business_readiness:
                business_readiness = business_data

        # Start parallel assessment
        result = risk_service.assess_risk_parallel(
            request.application_ids,
            team_readiness_inputs=team_readiness,
            business_readiness_inputs=business_readiness,
            max_workers=request.max_workers
        )

        return result

    except botocore.exceptions.ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']
        logger.error(f'Bedrock error in assess_risk_parallel: {error_code} — {error_msg}')
        status_map = {
            'ThrottlingException': 429,
            'ModelTimeoutException': 408,
            'AccessDeniedException': 403,
        }
        raise HTTPException(
            status_code=status_map.get(error_code, 500),
            detail=error_response(
                status_code=status_map.get(error_code, 500),
                error_type=error_code,
                message=f'AI analysis error: {error_code}. Please try again.',
            )
        )
    except Exception as e:
        logger.exception('Error in assess_risk_parallel')
        raise HTTPException(
            status_code=500,
            detail=error_response(
                status_code=500,
                error_type='INTERNAL_ERROR',
                message='An unexpected error occurred during bulk assessment.',
            )
        )


@router.get("/assessments")
async def list_assessments(
    app_id: Optional[str] = Query(None),
    sort: str = Query('date_desc', pattern='^(date_desc|date_asc)$'),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """List all risk assessments with optional filtering."""
    try:
        if app_id:
            assessments = risk_service.get_assessments_by_app(app_id)
        else:
            assessments = risk_service.get_all_assessments()

        # POD-scoped filtering: restrict to accessible apps
        allowed = get_accessible_app_ids(user)
        if allowed is not None:
            assessments = [a for a in assessments if a.get('app_id') in allowed]

        # Sort assessments
        if sort == 'date_desc':
            assessments = sorted(assessments, key=lambda x: x.get('assessment_date', 0), reverse=True)
        elif sort == 'date_asc':
            assessments = sorted(assessments, key=lambda x: x.get('assessment_date', 0))

        return {
            'success': True,
            'assessments': assessments,
            'count': len(assessments)
        }

    except Exception as e:
        logger.exception('Error in list_assessments')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/assessments/latest", deprecated=True)
async def get_latest_assessment(
    app_id: str = Query(...),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get the latest assessment for an application."""
    try:
        # Get all assessments for the app
        assessments = risk_service.get_assessments_by_app(app_id)

        if not assessments:
            raise HTTPException(status_code=404, detail={'error': 'No assessments found for this application'})

        # Sort by date descending and get the first one (latest)
        latest = sorted(assessments, key=lambda x: x.get('assessment_date', 0), reverse=True)[0]

        # Mark it as latest
        latest['is_latest'] = True

        return latest

    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Error in get_latest_assessment')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/assessments/{assessment_id}", deprecated=True)
async def get_assessment(
    assessment_id: str = Path(...),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get assessment metadata."""
    try:
        assessment = risk_service.get_assessment(assessment_id)

        if not assessment:
            raise HTTPException(status_code=404, detail={'error': 'Assessment not found'})

        return assessment

    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Error in get_assessment')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/report/{assessment_id}")
async def get_full_report(
    assessment_id: str = Path(...),
    format: str = Query('json', pattern='^(json|html)$'),
    save: bool = Query(False),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get full detailed report from S3."""
    try:
        # Get assessment metadata
        assessment = risk_service.get_assessment(assessment_id)
        if not assessment:
            raise HTTPException(status_code=404, detail={'error': 'Assessment not found'})

        # Check for old assessment format
        if 'results' in assessment and 's3_report_key' not in assessment:
            raise HTTPException(
                status_code=404,
                detail={
                    'error': 'This assessment was created with an older version. Please run a new assessment to see the detailed report.',
                    'legacy_data': assessment
                }
            )

        s3_report_key = assessment.get('s3_report_key')
        if not s3_report_key:
            raise HTTPException(status_code=404, detail={'error': 'Report not available - no S3 key found'})

        # Load full report from S3
        report = risk_service.get_full_report_from_s3(s3_report_key)
        if not report:
            raise HTTPException(status_code=404, detail={'error': 'Failed to load report from S3'})

        # Return HTML format if requested
        if format == 'html':
            from app.utils.report_generator import generate_html_report
            html_content = generate_html_report(report)

            if save:
                html_key = s3_report_key.replace('.json', '.html')
                risk_service.save_html_report_to_s3(html_key, html_content)

            return Response(content=html_content, media_type='text/html')

        # Default: return JSON
        return report

    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Error in get_full_report')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/summary", deprecated=True)
async def get_summary(
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get risk summary across all applications."""
    try:
        summary = risk_service.get_risk_summary()
        return summary

    except Exception as e:
        logger.exception('Error in get_summary')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/complexity/{app_id}", deprecated=True)
async def get_complexity(
    app_id: str = Path(...),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get complexity score for application."""
    try:
        complexity = risk_service.get_complexity_score(app_id)
        return complexity

    except Exception as e:
        logger.exception('Error in get_complexity')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/readiness/{app_id}", deprecated=True)
async def get_readiness(
    app_id: str = Path(...),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get readiness score for application."""
    try:
        readiness = risk_service.get_readiness_score(app_id)
        return readiness

    except Exception as e:
        logger.exception('Error in get_readiness')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})


@router.get("/actionable-items/{app_id}", deprecated=True)
async def get_actionable_items(
    app_id: str = Path(...),
    user: User = Depends(get_current_user),
    risk_service: RiskService = Depends(get_risk_service)
):
    """Get actionable items for application."""
    try:
        items = risk_service.get_actionable_items(app_id)
        return {'app_id': app_id, 'items': items}

    except Exception as e:
        logger.exception('Error in get_actionable_items')
        raise HTTPException(status_code=500, detail={'error': _GENERIC_ERROR})
