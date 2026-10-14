"""
Tests for the ARA auth adapter (app.utils.auth).

Validates:
- 3.1: Existing User import still works with the new dataclass
- 3.2: get_current_user returns User with both groups and persona
- 3.3: require_privileged accepts users in any Privileged_Groups
- 3.4: require_privileged rejects users with only viewer or MigrationEngineer
- 3.5: Dev mode returns mock user with correct groups and computed persona
"""

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from uno_auth.backends import reset_auth_backend
from uno_auth.groups import PRIVILEGED_GROUPS
from uno_auth.types import User as UnoUser

# ---------------------------------------------------------------------------
# 3.1 — User dataclass import and construction
# ---------------------------------------------------------------------------


class TestUserDataclass:
    """The adapter User is a dataclass with computed persona."""

    def test_import_user_from_adapter(self):
        from app.utils.auth import User

        assert User is not None

    def test_user_has_groups_and_persona(self):
        from app.utils.auth import User

        u = User(
            user_id="u1",
            email="a@b.com",
            display_name="A",
            groups=["admin", "privileged"],
        )
        assert u.groups == ["admin", "privileged"]
        assert u.persona == "privileged"

    def test_user_viewer_persona(self):
        from app.utils.auth import User

        u = User(
            user_id="u2",
            email="v@b.com",
            display_name="V",
            groups=["viewer"],
        )
        assert u.persona == "viewer"

    def test_user_empty_groups_defaults_viewer(self):
        from app.utils.auth import User

        u = User(user_id="u3", email="e@b.com", display_name="E")
        assert u.groups == []
        assert u.persona == "viewer"


# ---------------------------------------------------------------------------
# 3.2 — get_current_user returns User with groups and persona
# ---------------------------------------------------------------------------


class TestGetCurrentUser:
    """get_current_user wraps uno_auth User into the adapter User."""

    @pytest.fixture()
    def app_with_user_endpoint(self):
        """Minimal FastAPI app that exposes the current user."""
        from app.utils.auth import User, get_current_user

        app = FastAPI()

        @app.get("/me")
        async def me(user: User = Depends(get_current_user)):
            return {
                "user_id": user.user_id,
                "email": user.email,
                "display_name": user.display_name,
                "groups": user.groups,
                "persona": user.persona,
            }

        return app

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_returns_user_with_groups_and_persona(
        self, mock_get_backend, app_with_user_endpoint
    ):
        mock_backend = mock_get_backend.return_value
        mock_backend.resolve_user.return_value = UnoUser(
            user_id="uid-1",
            email="test@example.com",
            display_name="Test User",
            groups=["admin", "MigrationAdmin"],
        )

        client = TestClient(app_with_user_endpoint)
        resp = client.get("/me", headers={"Authorization": "Bearer fake-token"})

        assert resp.status_code == 200
        body = resp.json()
        assert body["user_id"] == "uid-1"
        assert body["groups"] == ["admin", "MigrationAdmin"]
        assert body["persona"] == "privileged"

    @patch("uno_auth.fastapi.get_auth_backend")
    def test_viewer_groups_resolve_viewer_persona(
        self, mock_get_backend, app_with_user_endpoint
    ):
        mock_backend = mock_get_backend.return_value
        mock_backend.resolve_user.return_value = UnoUser(
            user_id="uid-2",
            email="viewer@example.com",
            display_name="Viewer",
            groups=["viewer"],
        )

        client = TestClient(app_with_user_endpoint)
        resp = client.get("/me", headers={"Authorization": "Bearer fake-token"})

        assert resp.status_code == 200
        body = resp.json()
        assert body["groups"] == ["viewer"]
        assert body["persona"] == "viewer"


# ---------------------------------------------------------------------------
# 3.3 — require_privileged accepts users in any Privileged_Groups
# ---------------------------------------------------------------------------


class TestRequirePrivilegedAccepts:
    """require_privileged grants access to admin, MigrationAdmin, privileged, SuperAdmin."""

    @pytest.fixture()
    def privileged_app(self):
        from app.utils.auth import User, require_privileged

        app = FastAPI()

        @app.get("/priv")
        async def priv(user: User = Depends(require_privileged)):
            return {"user_id": user.user_id, "groups": user.groups}

        return app

    @pytest.mark.parametrize(
        "group",
        sorted(PRIVILEGED_GROUPS),
        ids=sorted(PRIVILEGED_GROUPS),
    )
    @patch("uno_auth.fastapi.get_auth_backend")
    def test_accepts_each_privileged_group(
        self, mock_get_backend, group, privileged_app
    ):
        mock_backend = mock_get_backend.return_value
        mock_backend.resolve_user.return_value = UnoUser(
            user_id="uid-priv",
            email="priv@example.com",
            display_name="Priv",
            groups=[group],
        )

        client = TestClient(privileged_app)
        resp = client.get("/priv", headers={"Authorization": "Bearer fake"})

        assert resp.status_code == 200, f"Expected 200 for group '{group}', got {resp.status_code}"
        assert group in resp.json()["groups"]


# ---------------------------------------------------------------------------
# 3.4 — require_privileged rejects viewer / MigrationEngineer
# ---------------------------------------------------------------------------


class TestRequirePrivilegedRejects:
    """require_privileged returns 403 for non-privileged groups."""

    @pytest.fixture()
    def privileged_app(self):
        from app.utils.auth import User, require_privileged

        app = FastAPI()

        @app.get("/priv")
        async def priv(user: User = Depends(require_privileged)):
            return {"ok": True}

        return app

    @pytest.mark.parametrize("group", ["viewer", "MigrationEngineer"])
    @patch("uno_auth.fastapi.get_auth_backend")
    def test_rejects_non_privileged_group(
        self, mock_get_backend, group, privileged_app
    ):
        mock_backend = mock_get_backend.return_value
        mock_backend.resolve_user.return_value = UnoUser(
            user_id="uid-np",
            email="np@example.com",
            display_name="NP",
            groups=[group],
        )

        client = TestClient(privileged_app)
        resp = client.get("/priv", headers={"Authorization": "Bearer fake"})

        assert resp.status_code == 403, f"Expected 403 for group '{group}', got {resp.status_code}"


# ---------------------------------------------------------------------------
# 3.5 — Dev mode returns mock user with correct groups and persona
# ---------------------------------------------------------------------------


class TestDevMode:
    """APP_ENV=development uses DevAuthBackend with persona-to-groups mapping."""

    @pytest.fixture(autouse=True)
    def _reset_backend(self):
        """Reset the cached auth backend before and after each test."""
        reset_auth_backend()
        yield
        reset_auth_backend()

    @pytest.fixture()
    def dev_app(self):
        from app.utils.auth import User, get_current_user

        app = FastAPI()

        @app.get("/me")
        async def me(user: User = Depends(get_current_user)):
            return {
                "user_id": user.user_id,
                "email": user.email,
                "display_name": user.display_name,
                "groups": user.groups,
                "persona": user.persona,
            }

        return app

    # Dev mode still requires an Authorization header (the DevAuthBackend
    # ignores the token value, but the FastAPI dependency checks for presence).
    DEV_HEADERS = {"Authorization": "Bearer dev-token"}

    @patch.dict(os.environ, {"APP_ENV": "development", "DEV_PERSONA": "privileged"})
    def test_dev_privileged_persona(self, dev_app):
        client = TestClient(dev_app)
        resp = client.get("/me", headers=self.DEV_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert set(body["groups"]) == {"admin", "privileged", "SuperAdmin"}
        assert body["persona"] == "privileged"
        assert body["user_id"] == "dev-user-001"

    @patch.dict(os.environ, {"APP_ENV": "development", "DEV_PERSONA": "readonly"})
    def test_dev_readonly_persona(self, dev_app):
        client = TestClient(dev_app)
        resp = client.get("/me", headers=self.DEV_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["groups"] == ["viewer"]
        assert body["persona"] == "viewer"

    @patch.dict(os.environ, {"APP_ENV": "development", "DEV_PERSONA": "admin"})
    def test_dev_admin_persona(self, dev_app):
        client = TestClient(dev_app)
        resp = client.get("/me", headers=self.DEV_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert set(body["groups"]) == {"admin", "MigrationAdmin", "privileged", "SuperAdmin"}
        assert body["persona"] == "privileged"

    @patch.dict(os.environ, {"APP_ENV": "development", "DEV_PERSONA": "migration"})
    def test_dev_migration_persona(self, dev_app):
        client = TestClient(dev_app)
        resp = client.get("/me", headers=self.DEV_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert set(body["groups"]) == {"MigrationAdmin", "MigrationEngineer"}
        assert body["persona"] == "privileged"

    @patch.dict(os.environ, {"APP_ENV": "development", "DEV_PERSONA": "viewer"})
    def test_dev_viewer_persona(self, dev_app):
        client = TestClient(dev_app)
        resp = client.get("/me", headers=self.DEV_HEADERS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["groups"] == ["viewer"]
        assert body["persona"] == "viewer"
