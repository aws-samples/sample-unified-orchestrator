"""Auth adapter — simple Cognito JWT validation (no haf-uno-auth dependency).

Validates Bearer tokens from Cognito, extracts user info from claims.
In dev mode (APP_ENV=development), returns a mock user without validation.

Exports: User, get_current_user, get_accessible_app_ids, router
"""

import os
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from jose import JWTError, jwk, jwt
from jose.utils import base64url_decode

logger = logging.getLogger(__name__)

_DEV_MODE = os.environ.get('APP_ENV', 'production') == 'development'

# Cognito configuration
COGNITO_REGION = os.environ.get('COGNITO_REGION', os.environ.get('AWS_REGION', 'us-east-1'))
COGNITO_USER_POOL_ID = os.environ.get('COGNITO_USER_POOL_ID', '')
COGNITO_APP_CLIENT_ID = os.environ.get('COGNITO_APP_CLIENT_ID', '')

# ALB region for validating the x-amzn-oidc-data signature (defaults to AWS_REGION).
ALB_REGION = os.environ.get('ALB_REGION', os.environ.get('AWS_REGION', 'us-east-1'))

# Fail closed: in production the app client ID is required so audience is always verified.
if not _DEV_MODE and not COGNITO_APP_CLIENT_ID:
    raise RuntimeError(
        "COGNITO_APP_CLIENT_ID must be set in production so JWT audience is verified "
        "(verify_aud). Refusing to start with audience verification disabled."
    )

# JWKS cache
_jwks_cache: dict = {}
_jwks_cache_time: float = 0
_JWKS_CACHE_TTL = 3600  # 1 hour

# ALB public-key cache (kid -> PEM public key)
_alb_key_cache: dict = {}


# --- Auth router (frontend calls GET /api/v1/config/auth on mount) ---
router = APIRouter(prefix="/api/v1", tags=["auth"])


# --- Persona resolution (simple group-based) ---
PRIVILEGED_GROUPS = {
    'AP-AWS-UNO-ADMIN', 'AP-AWS-UNO-PROSERVE', 'AP-AWS-UNO-ATT',
    'AP-AWS-AMP-ADMIN', 'privileged',
}


def resolve_persona(groups: list[str]) -> str:
    """Resolve persona from Cognito groups."""
    for g in groups:
        if g in PRIVILEGED_GROUPS:
            return 'privileged'
    return 'viewer'


@dataclass
class User:
    """User extracted from Cognito JWT claims."""

    user_id: str
    email: str
    display_name: str
    persona: str
    groups: list[str] = field(default_factory=list)


def _get_dev_user() -> User:
    """Build a mock user for local development."""
    persona = os.environ.get('DEV_PERSONA', 'privileged')
    return User(
        user_id='dev-user-001',
        email='dev@localhost',
        display_name=f'Dev User ({persona})',
        persona=persona,
        groups=['AP-AWS-AMP-ADMIN', 'privileged'],
    )


def _get_jwks() -> dict:
    """Fetch and cache JWKS from Cognito."""
    global _jwks_cache, _jwks_cache_time

    if _jwks_cache and (time.time() - _jwks_cache_time) < _JWKS_CACHE_TTL:
        return _jwks_cache

    jwks_url = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
    try:
        resp = requests.get(jwks_url, timeout=5)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_time = time.time()
        return _jwks_cache
    except Exception as e:
        logger.error("Failed to fetch JWKS: %s", e)
        if _jwks_cache:
            return _jwks_cache  # return stale cache
        raise HTTPException(status_code=503, detail="Unable to validate tokens")


def _get_alb_public_key(kid: str) -> str:
    """Fetch (and cache) the ALB public key PEM for a given key id."""
    if kid in _alb_key_cache:
        return _alb_key_cache[kid]
    url = f"https://public-keys.auth.elb.{ALB_REGION}.amazonaws.com/{kid}"
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        pem = resp.text
        _alb_key_cache[kid] = pem
        return pem
    except Exception as e:
        logger.error("Failed to fetch ALB public key for kid=%s: %s", kid, e)
        raise HTTPException(status_code=503, detail="Unable to validate ALB token")


def _decode_alb_oidc(oidc_data: str) -> dict:
    """Validate and decode the ALB-signed x-amzn-oidc-data header (ES256).

    The ALB signs this header; we MUST verify the signature against the ALB's
    regional public key. Trusting it unverified would let any request that
    reaches the container outside the ALB forge identity claims.
    """
    try:
        headers = jwt.get_unverified_headers(oidc_data)
    except JWTError as e:
        logger.warning("ALB OIDC header malformed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid ALB authentication token")

    kid = headers.get('kid')
    if not kid:
        raise HTTPException(status_code=401, detail="ALB token missing key id")

    public_key = _get_alb_public_key(kid)
    try:
        # ALB uses ES256. Audience/issuer are not part of this token; verify signature + expiry.
        return jwt.decode(oidc_data, public_key, algorithms=['ES256'])
    except JWTError as e:
        logger.warning("ALB OIDC signature validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid ALB authentication token")


def _decode_token(token: str) -> dict:
    """Validate and decode a Cognito JWT token."""
    if not COGNITO_USER_POOL_ID:
        raise HTTPException(status_code=500, detail="COGNITO_USER_POOL_ID not configured")

    jwks = _get_jwks()
    headers = jwt.get_unverified_headers(token)
    kid = headers.get('kid')

    # Find the matching key
    key = None
    for k in jwks.get('keys', []):
        if k['kid'] == kid:
            key = k
            break

    if not key:
        raise HTTPException(status_code=401, detail="Token key not found")

    issuer = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=['RS256'],
            audience=COGNITO_APP_CLIENT_ID,
            issuer=issuer,
            options={
                "verify_aud": True,
                "verify_exp": True,
            },
        )
        return claims
    except JWTError as e:
        logger.warning("JWT validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _extract_user_from_claims(claims: dict) -> User:
    """Extract User from Cognito JWT claims."""
    groups = claims.get('cognito:groups', [])
    email = claims.get('email', claims.get('username', ''))
    display_name = claims.get('name', claims.get('cognito:username', email))
    user_id = claims.get('sub', '')

    return User(
        user_id=user_id,
        email=email,
        display_name=display_name,
        persona=resolve_persona(groups),
        groups=groups,
    )


async def get_current_user(request: Request) -> User:
    """Extract and validate user from Bearer token or ALB header."""
    if _DEV_MODE:
        return _get_dev_user()

    # Try Bearer token first
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        claims = _decode_token(token)
        return _extract_user_from_claims(claims)

    # Try ALB OIDC header (x-amzn-oidc-data) — signature MUST be verified.
    oidc_data = request.headers.get('x-amzn-oidc-data', '')
    if oidc_data:
        claims = _decode_alb_oidc(oidc_data)
        return _extract_user_from_claims(claims)

    raise HTTPException(status_code=401, detail="Missing or invalid authentication")


def get_accessible_app_ids(user: User) -> set[str] | None:
    """Return application IDs the user can access, or None if unrestricted.

    For now, all authenticated users have unrestricted access.
    POD-based scoping can be added later if needed.
    """
    return None  # unrestricted


def require_privileged(user: User = Depends(get_current_user)) -> User:
    """Dependency that requires privileged persona."""
    if user.persona != 'privileged':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions — privileged access required",
        )
    return user


def require_app_access(user: User = Depends(get_current_user)) -> User:
    """Dependency for app-level access (currently same as get_current_user)."""
    return user


# --- Auth endpoint (consumed by frontend AuthContext on mount) ---


@router.get("/config/auth")
async def get_auth_config(user: User = Depends(get_current_user)):
    """Return the authenticated user's identity."""
    return {
        "user_id": user.user_id,
        "email": user.email,
        "display_name": user.display_name,
        "persona": user.persona,
        "groups": user.groups,
    }
