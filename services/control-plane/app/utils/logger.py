"""Logging configuration and request logging middleware."""
import logging
import json
import time
from datetime import datetime

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import Settings

logger = logging.getLogger(__name__)


class JSONFormatter(logging.Formatter):
    """JSON log formatter."""

    def format(self, record):
        """Format log record as JSON."""
        log_data = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno
        }

        # Add exception info if present
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging HTTP requests."""

    async def dispatch(self, request: Request, call_next):
        """Log method, path, and remote_addr on each request."""
        client_ip = request.client.host if request.client else "unknown"
        logger.info(
            f"Request: {request.method} {request.url.path} from {client_ip}"
        )

        start_time = time.time()
        try:
            response = await call_next(request)
        except Exception as e:
            duration = time.time() - start_time
            logger.error(
                f"Request failed: {request.method} {request.url.path} "
                f"duration={duration:.3f}s error={str(e)}"
            )
            raise

        duration = time.time() - start_time
        logger.info(
            f"Request completed: {request.method} {request.url.path} "
            f"status={response.status_code} duration={duration:.3f}s"
        )

        return response


def setup_logging(settings: Settings):
    """Set up application logging.

    Args:
        settings: A Settings object providing LOG_LEVEL.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, settings.LOG_LEVEL, logging.INFO))

    # Suppress noisy third-party loggers
    logging.getLogger('aiobotocore').setLevel(logging.WARNING)
    logging.getLogger('botocore').setLevel(logging.WARNING)
