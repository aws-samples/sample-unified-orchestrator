"""Pattern analysis API endpoints - FastAPI version."""
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, Path, HTTPException, Response

from app.models.requests import WavePatternAnalysisRequest, ATXMappingSubmission
from app.services.pattern_service import PatternService
from app.dependencies import get_pattern_service
from app.utils.auth import User, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/ara/patterns",
    tags=["Pattern Analysis"]
)

_GENERIC_ERROR = 'Internal server error'


# ------------------------------------------------------------------ #
#  ATX Transformation Endpoints (must be before /{pattern_id} catch-all)
# ------------------------------------------------------------------ #

@router.get("/atx/transformations", deprecated=True)
async def get_atx_transformations(
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Get ATX transformation definitions from uploaded ATX file."""
    try:
        result = pattern_service.get_atx_transformations()
        if result['success']:
            return {
                'success': True,
                'transformations': result['transformations'],
                'file_key': result.get('file_key'),
                'last_modified': result.get('last_modified'),
                'count': len(result['transformations'])
            }
        else:
            raise HTTPException(
                status_code=404,
                detail={'success': False, 'error': result.get('error'), 'transformations': []}
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting ATX transformations: {str(e)}")
        raise HTTPException(status_code=500, detail={'success': False, 'error': _GENERIC_ERROR})


@router.get("", deprecated=True)
async def list_patterns(
    wave_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    complexity: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """List discovered patterns with optional filters."""
    try:
        types = [t.strip() for t in type.split(',')] if type else None
        complexities = [c.strip() for c in complexity.split(',')] if complexity else None

        patterns = pattern_service.list_patterns(
            wave_id=wave_id,
            types=types,
            complexity_levels=complexities,
            search_term=search,
        )

        return {
            'success': True,
            'patterns': patterns,
            'count': len(patterns),
        }
    except Exception as e:
        logger.error(f"Error listing patterns: {str(e)}")
        raise HTTPException(status_code=500, detail={'success': False, 'error': _GENERIC_ERROR})


@router.get("/{pattern_id}", deprecated=True)
async def get_pattern(
    pattern_id: str = Path(...),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Get a specific pattern by transformation_id."""
    try:
        pattern = pattern_service.get_pattern(pattern_id)
        if not pattern:
            raise HTTPException(status_code=404, detail={'success': False, 'error': 'Pattern not found'})
        return {'success': True, 'pattern': pattern}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pattern {pattern_id}: {str(e)}")
        raise HTTPException(status_code=500, detail={'success': False, 'error': _GENERIC_ERROR})


@router.post("/{pattern_id}/generate-atx", deprecated=True)
async def generate_atx(
    pattern_id: str = Path(...),
    user: User = Depends(get_current_user)
):
    """Generate ATX prompts for a pattern (Sprint 3)."""
    return {'success': False, 'message': 'ATX generation will be implemented in Sprint 3'}


# ------------------------------------------------------------------ #
#  Wave Pattern Analysis Endpoints
# ------------------------------------------------------------------ #

@router.post("/wave/{wave_id}/analyze")
async def analyze_wave_patterns(
    wave_id: str = Path(...),
    body: Optional[WavePatternAnalysisRequest] = None,
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Run wave pattern analysis for a specific wave."""
    try:
        logger.info(f"Received wave pattern analysis request for wave {wave_id}")

        similarity_threshold = body.similarity_threshold if body else 70

        # Validate threshold
        if not isinstance(similarity_threshold, int) or similarity_threshold < 0 or similarity_threshold > 100:
            raise HTTPException(
                status_code=400,
                detail={'success': False, 'error': 'similarity_threshold must be an integer between 0 and 100'}
            )

        logger.info(f"Using similarity threshold: {similarity_threshold}%")

        result = pattern_service.analyze_wave_patterns(wave_id, similarity_threshold)

        # No eligible applications
        if result.get('analyzed_count') == 0:
            return {
                'success': True,
                'wave_id': wave_id,
                'message': 'No applications eligible for wave analysis',
                'total_applications': result.get('total_applications', 0),
                'analyzed_count': 0,
                'excluded_count': result.get('excluded_count', 0),
                'exclusion_reasons': result.get('exclusion_reasons', {}),
                'analysis_timestamp': result.get('analysis_timestamp')
            }

        if result.get('error'):
            raise HTTPException(
                status_code=500,
                detail={'success': False, 'error': result['error'], 'wave_id': wave_id}
            )

        return {
            'success': True,
            'wave_id': wave_id,
            'analysis_id': result.get('analysis_id'),
            's3_key': result.get('s3_key'),
            's3_key_html': result.get('s3_key_html'),
            'executive_summary': result.get('executive_summary'),
            'patterns': result.get('patterns'),
            'statistics': result.get('statistics'),
            'recommendations': result.get('recommendations'),
            'performance_metrics': result.get('performance_metrics')
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing wave patterns for {wave_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={'success': False, 'error': _GENERIC_ERROR, 'wave_id': wave_id}
        )


@router.get("/wave/{wave_id}/analysis")
async def get_wave_pattern_analysis(
    wave_id: str = Path(...),
    analysis_id: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Get wave pattern analysis results."""
    try:
        result = pattern_service.get_wave_pattern_analysis(wave_id, analysis_id)
        if not result:
            raise HTTPException(
                status_code=404,
                detail={'success': False, 'error': 'Pattern analysis not found', 'wave_id': wave_id}
            )
        return {'success': True, 'wave_id': wave_id, 'analysis': result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting wave pattern analysis for {wave_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={'success': False, 'error': _GENERIC_ERROR, 'wave_id': wave_id}
        )


@router.get("/wave/{wave_id}/analyses")
async def list_wave_pattern_analyses(
    wave_id: str = Path(...),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """List all pattern analyses for a wave."""
    try:
        analyses = pattern_service.list_wave_pattern_analyses(wave_id)
        return {
            'success': True,
            'wave_id': wave_id,
            'analyses': analyses,
            'count': len(analyses)
        }
    except Exception as e:
        logger.error(f"Error listing wave pattern analyses for {wave_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={'success': False, 'error': _GENERIC_ERROR, 'wave_id': wave_id}
        )


@router.get("/wave/{wave_id}/analysis/{analysis_id}/report", deprecated=True)
async def get_wave_pattern_analysis_report(
    wave_id: str = Path(...),
    analysis_id: str = Path(...),
    format: str = Query('html', pattern='^(html|json)$'),
    download: bool = Query(False),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Get report for a specific wave pattern analysis."""
    try:
        if format == 'html':
            content = pattern_service.get_wave_pattern_analysis_html(wave_id, analysis_id)
            if not content:
                raise HTTPException(
                    status_code=404,
                    detail={'success': False, 'error': 'HTML report not found', 'wave_id': wave_id, 'analysis_id': analysis_id}
                )
            headers = {}
            if download:
                headers['Content-Disposition'] = f'attachment; filename="wave-{wave_id}-{analysis_id}.html"'
            return Response(content=content, media_type='text/html', headers=headers)
        else:
            content = pattern_service.get_wave_pattern_analysis_json(wave_id, analysis_id)
            if not content:
                raise HTTPException(
                    status_code=404,
                    detail={'success': False, 'error': 'JSON report not found', 'wave_id': wave_id, 'analysis_id': analysis_id}
                )
            headers = {}
            if download:
                headers['Content-Disposition'] = f'attachment; filename="wave-{wave_id}-{analysis_id}.json"'
            return Response(
                content=json.dumps(content, indent=2),
                media_type='application/json',
                headers=headers
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting report for {wave_id}/{analysis_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={'success': False, 'error': _GENERIC_ERROR, 'wave_id': wave_id, 'analysis_id': analysis_id}
        )


@router.post("/wave/{wave_id}/atx-mappings", deprecated=True)
async def submit_atx_mappings(
    wave_id: str = Path(...),
    body: ATXMappingSubmission = ...,
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Submit ATX transformation mappings for patterns in a wave."""
    try:
        mappings_data = [m.model_dump() for m in body.mappings]
        result = pattern_service.submit_atx_mappings(wave_id, mappings_data)

        if result['success']:
            return result
        else:
            status_code = 500 if 'errors' not in result else 207
            raise HTTPException(status_code=status_code, detail=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting ATX mappings for wave {wave_id}: {str(e)}")
        raise HTTPException(status_code=500, detail={'success': False, 'error': _GENERIC_ERROR})


@router.get("/wave/{wave_id}/atx-mappings")
async def get_atx_mappings(
    wave_id: str = Path(...),
    include_all: bool = Query(False),
    user: User = Depends(get_current_user),
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Get existing ATX mappings for a wave."""
    try:
        result = pattern_service.get_atx_mappings(wave_id, include_all=include_all)
        if result['success']:
            return result
        else:
            raise HTTPException(status_code=400, detail=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting ATX mappings for wave {wave_id}: {str(e)}")
        raise HTTPException(status_code=500, detail={'success': False, 'error': str(e)})
