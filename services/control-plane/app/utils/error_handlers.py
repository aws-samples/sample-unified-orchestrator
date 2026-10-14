"""FastAPI error handlers for consistent error responses."""
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI):
    """Register global exception handlers on the FastAPI application."""

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        """Handle all unhandled exceptions with full traceback logging."""
        logger.exception("Unhandled exception: %s", traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error"},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ):
        """Handle request validation errors."""
        details = []
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"][1:])  # Skip 'body'
            details.append({"field": field, "message": error["msg"]})
        return JSONResponse(
            status_code=422,
            content={"error": "Validation failed", "details": details},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ):
        """Handle HTTP exceptions — return the exception's status code and detail."""
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.detail},
        )
