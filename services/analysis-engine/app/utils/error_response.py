"""Standardized error response helper."""


def error_response(status_code: int, error_type: str, message: str, detail: str = None, user_friendly: bool = True) -> dict:
    """Return error response as a dict (FastAPI handles JSON serialization)."""
    body = {
        'error': message,
        'error_type': error_type,
        'status_code': status_code,
    }
    if detail and not user_friendly:
        body['detail'] = detail
    return body
