"""FastAPI application factory."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.utils.error_handlers import register_error_handlers
from app.utils.logger import RequestLoggingMiddleware, setup_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle handler."""
    settings = get_settings()
    setup_logging(settings)
    logger.info(f"UNO backend started (env={settings.APP_ENV})")

    # Safeguard: warn if dev mode is active with non-localhost CORS origins
    if settings.APP_ENV == "development":
        non_local = [o for o in settings.cors_origins_list if "localhost" not in o and "127.0.0.1" not in o]
        if non_local:
            logger.warning(
                "⚠️  APP_ENV=development with non-localhost CORS origins: %s. "
                "Auth is bypassed in dev mode — ensure this is not a production deployment.",
                non_local,
            )
        else:
            logger.info("Dev mode active — auth bypassed, mock user injected via DEV_PERSONA")
    yield
    logger.info("Application shutdown")


def create_app(config_name: str = "default") -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()
    is_prod = settings.APP_ENV == "production"

    app = FastAPI(
        title="Unified Orchestrator",
        version="1.0.0",
        docs_url=None if is_prod else "/api/v1/docs",
        redoc_url=None if is_prod else "/api/v1/redoc",
        openapi_url=None if is_prod else "/api/v1/openapi.json",
        lifespan=lifespan,
    )

    # --- Request logging middleware ------------------------------------
    # NOTE: Starlette processes middleware in reverse add-order, so the
    # middleware added LAST runs FIRST (outermost).  We add logging first
    # and CORS second so that CORS handles the preflight OPTIONS before
    # anything else touches the request.
    app.add_middleware(RequestLoggingMiddleware)

    # --- CORS (must be added AFTER other middleware so it runs first) ---
    # Origins are driven by the CORS_ORIGINS env var (comma-separated).
    # Defaults to ["http://localhost:3000"] — see Settings.cors_origins_list.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=["Content-Type", "Authorization"],
    )

    # --- Error handlers ------------------------------------------------
    register_error_handlers(app)

    # --- Routers -------------------------------------------------------
    from app.utils.auth import router as auth_router
    from app.api.application import router as application_router
    from app.api.pam import router as pam_router
    from app.api.notes import router as notes_router

    app.include_router(auth_router)
    app.include_router(application_router)
    app.include_router(pam_router)
    app.include_router(notes_router)

    # --- Health checks -------------------------------------------------
    @app.get("/health")
    def health_check():
        return {"status": "healthy"}

    @app.get("/api/health")
    def api_health_check():
        return {"status": "healthy", "api": "v1"}

    # --- Auth audit: flag any endpoint missing auth dependencies -------
    _audit_endpoint_auth(app)

    return app


# Paths that are intentionally public (no auth required)
_PUBLIC_PATHS = {"/health", "/api/health", "/api/v1/openapi.json", "/api/v1/docs", "/api/v1/redoc"}


def _audit_endpoint_auth(app: FastAPI) -> None:
    """Log a warning for any route whose handler lacks an auth dependency.

    Inspects each registered route and checks whether its dependency chain
    includes ``get_current_user``.  Public paths (health checks, docs) are excluded.
    """
    from app.utils.auth import get_current_user

    auth_funcs = {get_current_user}
    unprotected = []

    for route in app.routes:
        if not hasattr(route, "dependant"):
            continue  # mount / websocket / static — skip
        path = getattr(route, "path", "")
        if path in _PUBLIC_PATHS:
            continue

        # Walk the dependency tree for auth markers
        deps_to_check = list(route.dependant.dependencies)
        found_auth = False
        while deps_to_check:
            dep = deps_to_check.pop()
            if dep.call in auth_funcs:
                found_auth = True
                break
            # Check sub-dependencies
            if hasattr(dep, "dependencies"):
                deps_to_check.extend(dep.dependencies)

        if not found_auth:
            methods = getattr(route, "methods", set())
            unprotected.append(f"{','.join(sorted(methods))} {path}")

    if unprotected:
        logger.warning(
            "⚠️  AUTH AUDIT: %d endpoint(s) have no auth dependency — "
            "add get_current_user: %s",
            len(unprotected),
            unprotected,
        )
    else:
        logger.info("Auth audit passed — all non-public endpoints have auth dependencies")
