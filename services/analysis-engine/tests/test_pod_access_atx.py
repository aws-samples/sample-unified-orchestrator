"""Tests for ATX endpoint authorization after ARA revert.

Validates that the 4 app_id-scoped ATX endpoints use simple auth
(get_current_user or require_privileged) instead of require_app_access:
- GET  /atx/applications/{app_id}   → get_current_user
- GET  /atx/download/{app_id}/{run_id} → get_current_user
- POST /atx/extract/{app_id}        → require_privileged
- GET  /atx/transform/assessments/{app_id} → get_current_user

Requirements: 10.1, 10.2, 10.3, 10.4
"""

import pytest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from uno_auth.backends import reset_auth_backend
from uno_auth.pod_access import reset_pod_access_provider
from uno_auth.types import User as UnoUser


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ADMIN_USER = UnoUser(
    user_id="pod-user-1",
    email="admin@example.com",
    display_name="Admin User",
    groups=["admin", "viewer"],
)

PRIVILEGED_USER = UnoUser(
    user_id="pod-user-2",
    email="priv@example.com",
    display_name="Privileged User",
    groups=["admin", "MigrationAdmin", "privileged"],
)

NON_PRIVILEGED_USER = UnoUser(
    user_id="pod-user-3",
    email="viewer@example.com",
    display_name="Viewer User",
    groups=["viewer"],
)

AUTH_HEADERS = {"Authorization": "Bearer fake-token"}


def _make_mock_backend(user: UnoUser = None):
    backend = MagicMock()
    backend.resolve_user.return_value = user or ADMIN_USER
    return backend


@pytest.fixture(autouse=True)
def _reset_singletons():
    reset_auth_backend()
    reset_pod_access_provider()
    yield
    reset_auth_backend()
    reset_pod_access_provider()


@pytest.fixture
def client():
    """Build a TestClient using the real ATX router."""
    from app.api.atx import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# GET /applications/{app_id} — uses get_current_user (no POD check)
# ---------------------------------------------------------------------------


class TestGetApplicationAtx:
    """GET /atx/applications/{app_id} uses get_current_user — no POD access check."""

    @patch("app.api.atx._get_tasks_table")
    @patch("uno_auth.fastapi.get_auth_backend")
    def test_authenticated_user_can_access_any_app(
        self, mock_backend_fn, mock_table_fn, client
    ):
        """Any authenticated user can access the endpoint — no POD check."""
        mock_backend_fn.return_value = _make_mock_backend()
        mock_table = MagicMock()
        mock_table.query.return_value = {"Items": []}
        mock_table_fn.return_value = mock_table

        resp = client.get(
            "/api/v1/ara/atx/applications/App101?include=status",
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_no_pod_provider_called(
        self, mock_backend_fn, client
    ):
        """Verify no POD access provider is invoked."""
        mock_backend_fn.return_value = _make_mock_backend()

        with patch("uno_auth.fastapi.get_pod_access_provider") as mock_provider_fn:
            with patch("app.api.atx._get_tasks_table") as mock_table_fn:
                mock_table = MagicMock()
                mock_table.query.return_value = {"Items": []}
                mock_table_fn.return_value = mock_table

                resp = client.get(
                    "/api/v1/ara/atx/applications/App101?include=status",
                    headers=AUTH_HEADERS,
                )
                assert resp.status_code == 200
                mock_provider_fn.return_value.get_accessible_apps.assert_not_called()


# ---------------------------------------------------------------------------
# GET /download/{app_id}/{run_id} — uses get_current_user (no POD check)
# ---------------------------------------------------------------------------


class TestDownload:
    """GET /atx/download/{app_id}/{run_id} uses get_current_user — no POD access check."""

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_authenticated_user_can_access(
        self, mock_backend_fn, client
    ):
        """Any authenticated user can access download — returns 400 for missing params (not 403)."""
        mock_backend_fn.return_value = _make_mock_backend()

        resp = client.get(
            "/api/v1/ara/atx/download/App101/run-001",
            headers=AUTH_HEADERS,
        )
        # 400 because no file= or zip=true param, but NOT 403 (no POD check)
        assert resp.status_code == 400

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_no_pod_provider_called(
        self, mock_backend_fn, client
    ):
        """Verify no POD access provider is invoked."""
        mock_backend_fn.return_value = _make_mock_backend()

        with patch("uno_auth.fastapi.get_pod_access_provider") as mock_provider_fn:
            resp = client.get(
                "/api/v1/ara/atx/download/App101/run-001",
                headers=AUTH_HEADERS,
            )
            mock_provider_fn.return_value.get_accessible_apps.assert_not_called()


# ---------------------------------------------------------------------------
# POST /extract/{app_id} — uses require_privileged (no POD check)
# ---------------------------------------------------------------------------


class TestExtractAssessment:
    """POST /atx/extract/{app_id} uses require_privileged — no POD access check."""

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_privileged_user_can_access(
        self, mock_backend_fn, client
    ):
        """Privileged user passes auth — endpoint proceeds (may fail on S3, but not 403)."""
        mock_backend_fn.return_value = _make_mock_backend(PRIVILEGED_USER)

        resp = client.post(
            "/api/v1/ara/atx/extract/App101",
            headers=AUTH_HEADERS,
        )
        # Not 403 — privileged user passes auth. May get 500 from missing S3 config.
        assert resp.status_code != 403

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_non_privileged_user_denied(
        self, mock_backend_fn, client
    ):
        """Non-privileged user gets 403 from require_privileged."""
        mock_backend_fn.return_value = _make_mock_backend(NON_PRIVILEGED_USER)

        resp = client.post(
            "/api/v1/ara/atx/extract/App101",
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 403
        assert "elevated permissions" in resp.json()["detail"]

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_no_pod_provider_called(
        self, mock_backend_fn, client
    ):
        """Verify no POD access provider is invoked."""
        mock_backend_fn.return_value = _make_mock_backend(PRIVILEGED_USER)

        with patch("uno_auth.fastapi.get_pod_access_provider") as mock_provider_fn:
            resp = client.post(
                "/api/v1/ara/atx/extract/App101",
                headers=AUTH_HEADERS,
            )
            mock_provider_fn.return_value.get_accessible_apps.assert_not_called()


# ---------------------------------------------------------------------------
# GET /transform/assessments/{app_id} — uses get_current_user (no POD check)
# ---------------------------------------------------------------------------


class TestTransformAssessments:
    """GET /atx/transform/assessments/{app_id} uses get_current_user — no POD access check."""

    @patch("app.services.atx_transformation_assessment_service.ATXTransformationAssessmentService")
    @patch("uno_auth.fastapi.get_auth_backend")
    def test_authenticated_user_can_access(
        self, mock_backend_fn, mock_svc_cls, client
    ):
        """Any authenticated user can access — no POD check."""
        mock_backend_fn.return_value = _make_mock_backend()
        mock_svc_cls.return_value.get_transformation_assessments.return_value = []

        resp = client.get(
            "/api/v1/ara/atx/transform/assessments/App101",
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_no_pod_provider_called(
        self, mock_backend_fn, client
    ):
        """Verify no POD access provider is invoked."""
        mock_backend_fn.return_value = _make_mock_backend()

        with patch("uno_auth.fastapi.get_pod_access_provider") as mock_provider_fn:
            with patch("app.services.atx_transformation_assessment_service.ATXTransformationAssessmentService") as mock_svc:
                mock_svc.return_value.get_transformation_assessments.return_value = []
                resp = client.get(
                    "/api/v1/ara/atx/transform/assessments/App101",
                    headers=AUTH_HEADERS,
                )
                assert resp.status_code == 200
                mock_provider_fn.return_value.get_accessible_apps.assert_not_called()


# ---------------------------------------------------------------------------
# Auth header missing — all endpoints should return 401
# ---------------------------------------------------------------------------


class TestNoAuthHeader:
    """All endpoints return 401 without auth header."""

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_get_application_atx_401(self, mock_backend_fn, client):
        mock_backend_fn.return_value = _make_mock_backend()
        resp = client.get("/api/v1/ara/atx/applications/App101")
        assert resp.status_code == 401

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_download_401(self, mock_backend_fn, client):
        mock_backend_fn.return_value = _make_mock_backend()
        resp = client.get("/api/v1/ara/atx/download/App101/run-001")
        assert resp.status_code == 401

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_extract_401(self, mock_backend_fn, client):
        mock_backend_fn.return_value = _make_mock_backend()
        resp = client.post("/api/v1/ara/atx/extract/App101")
        assert resp.status_code == 401

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_transform_assessments_401(self, mock_backend_fn, client):
        mock_backend_fn.return_value = _make_mock_backend()
        resp = client.get("/api/v1/ara/atx/transform/assessments/App101")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# require_app_access remains importable from auth utils (Req 10.3)
# ---------------------------------------------------------------------------


class TestRequireAppAccessStillAvailable:
    """require_app_access is still importable for other features."""

    def test_require_app_access_importable_from_auth_utils(self):
        from app.utils.auth import require_app_access
        assert callable(require_app_access)
