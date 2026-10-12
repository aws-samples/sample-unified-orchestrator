"""FastAPI error handlers for consistent error responses."""
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import logging

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI):
    """Register global error handlers."""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        """Handle HTTP exceptions."""
        if exc.status_code == 404:
            return JSONResponse(
                status_code=404,
                content={'error': 'Not found'}
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={'error': exc.detail} if isinstance(exc.detail, str) else exc.detail
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handle request validation errors."""
        errors = []
        for error in exc.errors():
            field = '.'.join(str(x) for x in error['loc'][1:])  # Skip 'body'
            errors.append({
                'field': field,
                'message': error['msg']
            })

        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={'error': 'Validation failed', 'details': errors}
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Handle all unhandled exceptions."""
        logger.exception('Unhandled exception')
        return JSONResponse(
            status_code=500,
            content={'error': 'Internal server error'}
        )
