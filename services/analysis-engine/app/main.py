"""FastAPI application factory with multi-app Swagger support."""
import json
import logging
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html
from fastapi.responses import HTMLResponse, JSONResponse

from app.config import get_config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Registry of apps whose Swagger specs are served from this unified gateway.
# Each entry: {"name": <display>, "url": <openapi json path>}
#
# To add a new app, either:
#   1. Add an entry here pointing to its OpenAPI JSON path, or
#   2. Point to an external OpenAPI JSON URL served by another service.
# ---------------------------------------------------------------------------
SWAGGER_APPS: list[dict] = [
    {"name": "ARA - Application Replatform Analyzer", "url": "/api/v1/ara/openapi.json"},
    # Examples — uncomment or add as new apps are onboarded:
    # {"name": "UNO - Unified Orchestrator", "url": "/api/v1/uno/openapi.json"},
    # {"name": "WAM - Workload Assessment Manager", "url": "/api/v1/wam/openapi.json"},
    # {"name": "External Service", "url": "https://other-service.example.com/openapi.json"},
]


def create_app(config_name: str = 'default') -> FastAPI:
    """Create and configure FastAPI application."""

    config = get_config(config_name)

    app = FastAPI(
        title="ARA - Application Replatform Analyzer API",
        description="AI-powered application replatforming risk assessment and pattern analysis",
        version="1.0.0",
        # Serve OpenAPI JSON at the namespaced path
        openapi_url="/api/v1/ara/openapi.json",
        # Disable default /docs and /redoc — we serve custom ones below
        docs_url=None,
        redoc_url=None,
    )
    app.state.config = config

    # ---- CORS ----
    cors_origins = config.CORS_ORIGINS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_headers=['Content-Type', 'Authorization', 'X-Requested-With', 'X-Dev-Mode', 'X-Amzn-Oidc-Data'],
        allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        expose_headers=['Content-Type', 'Authorization'],
        max_age=3600,
    )

    # ---- Error handlers ----
    from app.utils.error_handlers import register_error_handlers
    register_error_handlers(app)

    # ---- Register API routers ----
    from app.api.risk import router as risk_router
    from app.api.patterns import router as patterns_router
    from app.api.wave import router as wave_router
    from app.api.atx import router as atx_router

    app.include_router(risk_router)
    app.include_router(patterns_router)
    app.include_router(wave_router)
    app.include_router(atx_router)

    # ---- Lifecycle events ----
    @app.on_event("startup")
    async def startup_event():
        logger.info("Application starting up")
        from app.strands.tools.risks.component_analyzer import warm_target_cache
        asyncio.create_task(asyncio.to_thread(warm_target_cache))
        # Reconcile any in-progress ATX tasks against ECS status
        from app.services.task_reconciler import reconcile_in_progress_tasks
        asyncio.create_task(asyncio.to_thread(reconcile_in_progress_tasks))

    @app.on_event("shutdown")
    async def shutdown_event():
        logger.info("Application shutting down")

    # ------------------------------------------------------------------
    # Multi-app Swagger UI at /api/v1/ara/docs
    # Inlines the local ARA spec to avoid Cognito auth issues on XHR fetches.
    # External app specs are still fetched via urls dropdown.
    # ------------------------------------------------------------------
    @app.get("/api/v1/ara/docs", response_class=HTMLResponse, include_in_schema=False)
    async def custom_swagger_ui():
        # Inline the ARA OpenAPI spec so Swagger UI doesn't need to fetch it
        spec = app.openapi()
        spec_json = json.dumps(spec)

        # Build urls list — external apps keep their URL, ARA uses inline spec
        urls_json = json.dumps(SWAGGER_APPS)
        primary_name = SWAGGER_APPS[0]["name"]

        html = (
            '<!DOCTYPE html>\n'
            '<html><head>\n'
            '<title>Platform API Docs</title>\n'
            '<meta charset="utf-8"/>\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1"/>\n'
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>\n'
            '</head><body>\n'
            '<div id="swagger-ui"></div>\n'
            '<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>\n'
            '<script>\n'
            'var spec = ' + spec_json + ';\n'
            'SwaggerUIBundle({\n'
            '  spec: spec,\n'
            '  urls: ' + urls_json + ',\n'
            '  "urls.primaryName": ' + json.dumps(primary_name) + ',\n'
            '  dom_id: "#swagger-ui",\n'
            '  deepLinking: true,\n'
            '  filter: true,\n'
            '  withCredentials: true,\n'
            '  presets: [SwaggerUIBundle.presets.apis],\n'
            '  layout: "BaseLayout"\n'
            '});\n'
            '</script>\n'
            '</body></html>'
        )
        return HTMLResponse(html)

    @app.get("/api/v1/ara/redoc", response_class=HTMLResponse, include_in_schema=False)
    async def custom_redoc(app_index: int = 0):
        idx = max(0, min(app_index, len(SWAGGER_APPS) - 1))
        return get_redoc_html(
            openapi_url=SWAGGER_APPS[idx]["url"],
            title=f"Platform API Docs — {SWAGGER_APPS[idx]['name']}",
        )

    @app.get("/api/v1/ara/openapi-registry", include_in_schema=False)
    async def openapi_registry():
        return JSONResponse(content={"apps": SWAGGER_APPS})

    # ---- Health endpoints ----
    @app.get("/api/v1/ara/health", include_in_schema=False)
    async def ara_health():
        return {'status': 'healthy', 'service': 'ara'}

    @app.get("/health", include_in_schema=False)
    async def health_check():
        return {'status': 'healthy'}

    @app.get("/api/health", include_in_schema=False)
    async def api_health_check():
        return {'status': 'healthy', 'api': 'v1'}

    return app
