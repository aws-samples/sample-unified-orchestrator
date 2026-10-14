"""
Integration tests for POST /status endpoint — dependency graph data.

Validates that the status API returns dependency_graph, execution_order,
mermaid_diagram, current_repo, current_repo_index, and repo_summaries
when the DynamoDB task record contains them (combined phased analysis).
"""

import json
import os
from datetime import datetime
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Force dev mode so auth is bypassed
os.environ.setdefault("APP_ENV", "development")

from app.main import create_app
from app.utils.auth import User


@pytest.fixture()
def client():
    """Create a FastAPI test client with mocked auth."""
    app = create_app()
    return TestClient(app)


def _make_task_record(**overrides: Any) -> Dict[str, Any]:
    """Build a minimal DynamoDB task record with sensible defaults."""
    record: Dict[str, Any] = {
        "task_id": "t-001",
        "application_id": "app-123",
        "task_type": "atx_run",
        "status": "processing",
        "run_id": "20240601_120000_abc12345",
        "repo_statuses": {
            "backend-api": {"status": "completed"},
            "frontend": {"status": "pending"},
        },
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    record.update(overrides)
    return record


def _mock_query_tasks(table_mock: MagicMock, items: list) -> None:
    """Configure the table mock to return items from query."""
    table_mock.query.return_value = {"Items": items}


# ── Basic status (no graph data) ─────────────────────────────────────


class TestCheckStatusBasic:
    """POST /status returns standard fields for non-combined tasks."""

    @patch("app.api.atx._get_tasks_table")
    def test_returns_basic_status_fields(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table

        task = _make_task_record()
        _mock_query_tasks(table, [task])

        resp = client.post(
            "/api/v1/ara/atx/status",
            json=["app-123"],
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True

        status_data = body["statuses"]["app-123"]
        assert "status" in status_data
        assert "total_repos" in status_data
        assert "completed_repos" in status_data
        assert "failed_repos" in status_data

        # No graph fields for a regular task
        assert "dependency_graph" not in status_data
        assert "execution_order" not in status_data
        assert "mermaid_diagram" not in status_data

    @patch("app.api.atx._get_tasks_table")
    def test_missing_app_returns_empty(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table
        _mock_query_tasks(table, [])

        resp = client.post("/api/v1/ara/atx/status", json=["nonexistent"])
        assert resp.status_code == 200
        assert resp.json()["statuses"] == {}


# ── Combined phased analysis — graph data ────────────────────────────


class TestCheckStatusCombinedGraph:
    """POST /status includes dependency graph fields for combined tasks."""

    SAMPLE_GRAPH = {
        "infra": [],
        "database": ["infra"],
        "backend-api": ["database"],
        "frontend": ["backend-api"],
    }
    SAMPLE_ORDER = ["infra", "database", "backend-api", "frontend"]
    SAMPLE_MERMAID = (
        "graph TD\n"
        "  database --> infra\n"
        "  backend-api --> database\n"
        "  frontend --> backend-api"
    )

    def _combined_task(self, **extra: Any) -> Dict[str, Any]:
        return _make_task_record(
            task_type="atx_combined",
            dependency_graph=self.SAMPLE_GRAPH,
            execution_order=self.SAMPLE_ORDER,
            mermaid_diagram=self.SAMPLE_MERMAID,
            current_repo="backend-api",
            current_repo_index=2,
            repo_statuses={
                "infra": {"status": "completed"},
                "database": {"status": "completed"},
                "backend-api": {"status": "analyzing"},
                "frontend": {"status": "pending"},
            },
            **extra,
        )

    @patch("app.api.atx._get_tasks_table")
    def test_includes_dependency_graph(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table
        _mock_query_tasks(table, [self._combined_task()])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["dependency_graph"] == self.SAMPLE_GRAPH

    @patch("app.api.atx._get_tasks_table")
    def test_includes_execution_order(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table
        _mock_query_tasks(table, [self._combined_task()])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["execution_order"] == self.SAMPLE_ORDER

    @patch("app.api.atx._get_tasks_table")
    def test_includes_mermaid_diagram(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table
        _mock_query_tasks(table, [self._combined_task()])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["mermaid_diagram"] == self.SAMPLE_MERMAID

    @patch("app.api.atx._get_tasks_table")
    def test_includes_current_repo_and_index(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table
        _mock_query_tasks(table, [self._combined_task()])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["current_repo"] == "backend-api"
        assert status_data["current_repo_index"] == 2

    @patch("app.api.atx._get_tasks_table")
    def test_includes_repo_summaries_when_present(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table

        summaries = {
            "infra": "infra (hcl, terraform): ECS Fargate, RDS PostgreSQL",
            "database": "database (python): Flyway migrations, PostgreSQL 14",
        }
        task = self._combined_task(repo_summaries=summaries)
        _mock_query_tasks(table, [task])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["repo_summaries"] == summaries

    @patch("app.api.atx._get_tasks_table")
    def test_omits_repo_summaries_when_absent(self, mock_table_fn, client):
        table = MagicMock()
        mock_table_fn.return_value = table

        task = self._combined_task()
        # No repo_summaries key
        task.pop("repo_summaries", None)
        _mock_query_tasks(table, [task])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert "repo_summaries" not in status_data

    @patch("app.api.atx._get_tasks_table")
    def test_all_graph_fields_in_single_response(self, mock_table_fn, client):
        """Full integration: verify all graph fields appear together."""
        table = MagicMock()
        mock_table_fn.return_value = table

        summaries = {
            "infra": "infra (hcl, terraform): ECS Fargate cluster",
            "database": "database (python): PostgreSQL 14 migrations",
        }
        task = self._combined_task(repo_summaries=summaries)
        _mock_query_tasks(table, [task])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        assert resp.status_code == 200

        status_data = resp.json()["statuses"]["app-123"]

        # Standard fields
        assert status_data["status"] == "in_progress"
        assert status_data["total_repos"] == 4
        assert status_data["completed_repos"] == 2
        assert status_data["failed_repos"] == 0

        # Graph fields
        assert status_data["dependency_graph"] == self.SAMPLE_GRAPH
        assert status_data["execution_order"] == self.SAMPLE_ORDER
        assert status_data["mermaid_diagram"] == self.SAMPLE_MERMAID
        assert status_data["current_repo"] == "backend-api"
        assert status_data["current_repo_index"] == 2
        assert status_data["repo_summaries"] == summaries


# ── Backward compatibility ───────────────────────────────────────────


class TestCheckStatusBackwardCompat:
    """Graph fields are only included when the task record has them."""

    @patch("app.api.atx._get_tasks_table")
    def test_regular_atx_run_no_graph_fields(self, mock_table_fn, client):
        """A standard atx_run task should not have any graph fields."""
        table = MagicMock()
        mock_table_fn.return_value = table

        task = _make_task_record(task_type="atx_run")
        _mock_query_tasks(table, [task])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        for field in ("dependency_graph", "execution_order", "mermaid_diagram",
                      "current_repo", "current_repo_index", "repo_summaries"):
            assert field not in status_data

    @patch("app.api.atx._get_tasks_table")
    def test_current_repo_index_zero_is_included(self, mock_table_fn, client):
        """current_repo_index=0 should still be included (falsy but valid)."""
        table = MagicMock()
        mock_table_fn.return_value = table

        task = _make_task_record(
            dependency_graph={"infra": []},
            execution_order=["infra"],
            mermaid_diagram="graph TD\n  infra",
            current_repo="infra",
            current_repo_index=0,
        )
        _mock_query_tasks(table, [task])

        resp = client.post("/api/v1/ara/atx/status", json=["app-123"])
        status_data = resp.json()["statuses"]["app-123"]

        assert status_data["current_repo_index"] == 0
        assert status_data["current_repo"] == "infra"
