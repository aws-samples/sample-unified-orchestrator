"""
End-to-end tests for the combined phased analysis pipeline.

Tests cover:
- Full pipeline: dependency discovery → ordered execution → context chaining → assessment
- Repos with no inter-dependencies (arbitrary order, no edges)
- Circular dependencies (cycle broken, all repos analyzed)
- Repo failure mid-analysis (pipeline continues, dependents get failure note)
"""

import json
import textwrap
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

from app.workers.atx_worker import run_combined


# ── Helpers ──────────────────────────────────────────────────────────


def _make_repo(workspace: Path, name: str, build_files: Dict[str, str]) -> None:
    """Create a mock repo directory with the given build files."""
    repo_dir = workspace / name
    repo_dir.mkdir(parents=True, exist_ok=True)
    for filename, content in build_files.items():
        filepath = repo_dir / filename
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(content)


def _make_atx_docs(repo_dir: str, summary_text: str) -> None:
    """Create ATXDocumentation/summary.md in a repo directory."""
    docs = Path(repo_dir) / "ATXDocumentation"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / "summary.md").write_text(summary_text)


def _build_mock_table() -> MagicMock:
    """Build a mock DynamoDB table that records update_item calls."""
    table = MagicMock()
    table.update_item = MagicMock()
    return table


def _noop_clone(url: str, dest: str) -> Dict[str, Any]:
    """Mock clone that does nothing (repos are pre-created)."""
    return {"success": True, "branch": "main"}


def _noop_upload(repo_dir: str, app_id: str, run_id: str) -> Dict[str, Any]:
    return {"success": True, "uploaded": 3, "s3_prefix": f"atx-results/{app_id}/{run_id}"}


def _default_build_info(repo_dir: str) -> Dict[str, str]:
    return {"name": "maven", "build": "mvn package", "validate": "mvn test"}


@pytest.fixture
def workspace(tmp_path):
    """Create a workspace directory and patch run_combined to use it."""
    ws = tmp_path / "atx-workspace"
    ws.mkdir()
    return ws


@pytest.fixture
def mock_dynamo():
    """Provide a mock DynamoDB resource + table pair."""
    table = _build_mock_table()
    dynamodb = MagicMock()
    dynamodb.Table = MagicMock(return_value=table)
    return dynamodb, table


def _run_combined_with_workspace(
    workspace: Path,
    repo_urls: List[str],
    mock_dynamodb: MagicMock,
    mock_run_atx,
    mock_clone=_noop_clone,
    mock_upload=_noop_upload,
    mock_detect_build=_default_build_info,
    selected_files: List[str] | None = None,
    app_id: str = "app-1",
    run_id: str = "run-1",
    task_id: str = "task-001",
) -> Dict[str, Any]:
    """Call run_combined with all external services mocked.

    The workspace Path is injected by patching the work_dir construction
    inside run_combined so that repos are read from tmp_path.
    """
    target_work_dir = workspace / app_id / run_id

    with patch("app.config.Config.get_boto3_resource", return_value=mock_dynamodb), \
         patch("app.services.atx_service.ATXService._clone_repo", side_effect=mock_clone), \
         patch("app.services.atx_service.ATXService._run_atx", side_effect=mock_run_atx), \
         patch("app.services.atx_service.ATXService._run_atx_resume"), \
         patch("app.services.atx_service.ATXService._upload_results", side_effect=mock_upload), \
         patch("app.services.atx_service.ATXService._detect_build_system", side_effect=mock_detect_build), \
         patch("app.services.atx_service.ATXService._generate_config_yaml"), \
         patch("app.services.atx_service.ATXService._copy_system_prompt"), \
         patch("app.services.atx_service.ATXService._generate_app_insights"):

        # Patch the work_dir path so run_combined uses our tmp workspace
        import app.workers.atx_worker as wmod
        original_Path = Path

        class PatchedPath(type(Path())):
            """Subclass that intercepts the __file__-based path resolution."""
            pass

        # Directly monkeypatch the work_dir line by patching Path(__file__)
        # run_combined does: work_dir = Path(__file__).parent.parent.parent.parent / 'atx-workspace' / app_id / run_id
        # We override by making the workspace dir exist at the expected location
        # Simplest: just create a symlink or override the module-level Path usage

        # Actually the cleanest approach: just pre-create the target dir and
        # patch Path(__file__) to resolve to a path that leads to our workspace
        fake_file = workspace.parent / "backend" / "app" / "workers" / "atx_worker.py"
        fake_file.parent.mkdir(parents=True, exist_ok=True)
        fake_file.touch()

        # Now Path(fake_file).parent.parent.parent.parent / 'atx-workspace' == workspace
        # We need to make run_combined use fake_file as __file__
        original_file = wmod.__file__
        try:
            wmod.__file__ = str(fake_file)
            result = run_combined(
                task_id=task_id,
                app_id=app_id,
                repo_urls=repo_urls,
                run_id=run_id,
                selected_files=selected_files or [],
            )
        finally:
            wmod.__file__ = original_file

    return result


# ── Test 1: Full E2E pipeline ────────────────────────────────────────


class TestCombinedE2EFullPipeline:
    """E2E: 3 repos with dependencies → ordered analysis → context chaining."""

    def test_full_pipeline(self, workspace, mock_dynamo):
        """Verify dependency discovery → ordered execution → context chaining → results."""
        mock_dynamodb, mock_table = mock_dynamo
        app_id, run_id = "app-1", "run-1"
        work_dir = workspace / app_id / run_id
        work_dir.mkdir(parents=True)

        # Create 3 repos: shared-lib → backend-api → frontend
        _make_repo(work_dir, "shared-lib", {
            "pom.xml": textwrap.dedent("""\
                <?xml version="1.0"?>
                <project xmlns="http://maven.apache.org/POM/4.0.0">
                    <groupId>com.example</groupId>
                    <artifactId>shared-lib</artifactId>
                    <dependencies>
                        <dependency>
                            <groupId>org.slf4j</groupId>
                            <artifactId>slf4j-api</artifactId>
                            <version>2.0.0</version>
                        </dependency>
                    </dependencies>
                </project>
            """),
        })
        _make_repo(work_dir, "backend-api", {
            "pom.xml": textwrap.dedent("""\
                <?xml version="1.0"?>
                <project xmlns="http://maven.apache.org/POM/4.0.0">
                    <groupId>com.example</groupId>
                    <artifactId>backend-api</artifactId>
                    <dependencies>
                        <dependency>
                            <groupId>com.example</groupId>
                            <artifactId>shared-lib</artifactId>
                            <version>1.0.0</version>
                        </dependency>
                    </dependencies>
                </project>
            """),
        })
        _make_repo(work_dir, "frontend", {
            "package.json": json.dumps({
                "name": "frontend",
                "dependencies": {"backend-api": "^1.0.0", "react": "^18.0.0"},
            }),
        })

        atx_call_order: List[str] = []

        def mock_run_atx(repo_dir, config_path=None):
            repo_name = Path(repo_dir).name
            atx_call_order.append(repo_name)
            _make_atx_docs(repo_dir, f"{repo_name}: Java 11, Spring Boot 2.7, REST API")
            return {"success": True, "conversation_id": f"conv-{repo_name}", "returncode": 0}

        result = _run_combined_with_workspace(
            workspace=workspace,
            repo_urls=[
                "https://github.com/org/shared-lib.git",
                "https://github.com/org/backend-api.git",
                "https://github.com/org/frontend.git",
            ],
            mock_dynamodb=mock_dynamodb,
            mock_run_atx=mock_run_atx,
            app_id=app_id,
            run_id=run_id,
        )

        # Dependency graph correctness
        assert "shared-lib" in result["dependency_graph"]["backend-api"]
        assert "backend-api" in result["dependency_graph"]["frontend"]
        assert result["dependency_graph"]["shared-lib"] == []

        # Execution order respects dependencies
        order = result["execution_order"]
        assert order.index("shared-lib") < order.index("backend-api")
        assert order.index("backend-api") < order.index("frontend")

        # ATX was called in dependency order
        assert atx_call_order.index("shared-lib") < atx_call_order.index("backend-api")
        assert atx_call_order.index("backend-api") < atx_call_order.index("frontend")

        # Mermaid diagram generated
        assert result["mermaid_diagram"].startswith("graph TD")
        assert "backend-api --> shared-lib" in result["mermaid_diagram"]

        # All repos completed successfully
        assert result["completed_repos"] == 3
        assert result["failed_repos"] == 0
        assert result["success"] is True
        assert result["total_repos"] == 3

        # Context chaining: summaries collected for all repos
        for name in ["shared-lib", "backend-api", "frontend"]:
            assert name in result["repo_summaries"]
            assert len(result["repo_summaries"][name]) > 0

        # Conversation IDs stored
        for name in ["shared-lib", "backend-api", "frontend"]:
            assert result["conversation_ids"][name] == f"conv-{name}"

        # DynamoDB was updated (graph, order, per-repo statuses)
        assert mock_table.update_item.called


# ── Test 2: No inter-dependencies ────────────────────────────────────


class TestCombinedE2ENoInterDeps:
    """E2E: repos with no inter-dependencies should all be analyzed, arbitrary order."""

    def test_no_inter_dependencies(self, workspace, mock_dynamo):
        """Repos with unrelated deps produce empty graph edges, all still analyzed."""
        mock_dynamodb, mock_table = mock_dynamo
        app_id, run_id = "app-2", "run-2"
        work_dir = workspace / app_id / run_id
        work_dir.mkdir(parents=True)

        # 3 repos with no matching cross-dependencies
        _make_repo(work_dir, "service-alpha", {
            "requirements.txt": "flask==2.3.0\nrequests==2.31.0\n",
        })
        _make_repo(work_dir, "service-beta", {
            "package.json": json.dumps({
                "name": "service-beta",
                "dependencies": {"express": "^4.18.0"},
            }),
        })
        _make_repo(work_dir, "service-gamma", {
            "pom.xml": textwrap.dedent("""\
                <?xml version="1.0"?>
                <project xmlns="http://maven.apache.org/POM/4.0.0">
                    <dependencies>
                        <dependency>
                            <groupId>org.springframework</groupId>
                            <artifactId>spring-core</artifactId>
                            <version>5.3.0</version>
                        </dependency>
                    </dependencies>
                </project>
            """),
        })

        analyzed_repos: List[str] = []

        def mock_run_atx(repo_dir, config_path=None):
            repo_name = Path(repo_dir).name
            analyzed_repos.append(repo_name)
            _make_atx_docs(repo_dir, f"{repo_name}: standalone service")
            return {"success": True, "conversation_id": f"conv-{repo_name}", "returncode": 0}

        result = _run_combined_with_workspace(
            workspace=workspace,
            repo_urls=[
                "https://github.com/org/service-alpha.git",
                "https://github.com/org/service-beta.git",
                "https://github.com/org/service-gamma.git",
            ],
            mock_dynamodb=mock_dynamodb,
            mock_run_atx=mock_run_atx,
            app_id=app_id,
            run_id=run_id,
        )

        # No edges in dependency graph
        for repo_name, deps in result["dependency_graph"].items():
            assert deps == [], f"Expected no deps for {repo_name}, got {deps}"

        # All repos analyzed
        assert set(analyzed_repos) == {"service-alpha", "service-beta", "service-gamma"}
        assert result["completed_repos"] == 3
        assert result["failed_repos"] == 0
        assert result["success"] is True

        # All repos appear in execution order
        assert set(result["execution_order"]) == {"service-alpha", "service-beta", "service-gamma"}


# ── Test 3: Circular dependencies ────────────────────────────────────


class TestCombinedE2ECircularDeps:
    """E2E: repos with circular dependencies should break cycle and continue."""

    def test_circular_dependencies(self, workspace, mock_dynamo):
        """Two repos that depend on each other — cycle is broken, both analyzed."""
        mock_dynamodb, mock_table = mock_dynamo
        app_id, run_id = "app-3", "run-3"
        work_dir = workspace / app_id / run_id
        work_dir.mkdir(parents=True)

        # repo-a depends on repo-b, repo-b depends on repo-a
        _make_repo(work_dir, "repo-a", {
            "package.json": json.dumps({
                "name": "repo-a",
                "dependencies": {"repo-b": "^1.0.0"},
            }),
        })
        _make_repo(work_dir, "repo-b", {
            "package.json": json.dumps({
                "name": "repo-b",
                "dependencies": {"repo-a": "^1.0.0"},
            }),
        })

        analyzed_repos: List[str] = []

        def mock_run_atx(repo_dir, config_path=None):
            repo_name = Path(repo_dir).name
            analyzed_repos.append(repo_name)
            _make_atx_docs(repo_dir, f"{repo_name}: Node.js service")
            return {"success": True, "conversation_id": f"conv-{repo_name}", "returncode": 0}

        result = _run_combined_with_workspace(
            workspace=workspace,
            repo_urls=[
                "https://github.com/org/repo-a.git",
                "https://github.com/org/repo-b.git",
            ],
            mock_dynamodb=mock_dynamodb,
            mock_run_atx=mock_run_atx,
            app_id=app_id,
            run_id=run_id,
        )

        # Both repos analyzed despite cycle
        assert set(analyzed_repos) == {"repo-a", "repo-b"}
        assert result["completed_repos"] == 2
        assert result["failed_repos"] == 0
        assert result["success"] is True

        # Both repos in execution order
        assert set(result["execution_order"]) == {"repo-a", "repo-b"}

        # Mermaid diagram generated
        assert result["mermaid_diagram"].startswith("graph TD")


# ── Test 4: Repo fails mid-analysis ──────────────────────────────────


class TestCombinedE2ERepoFailure:
    """E2E: one repo fails mid-analysis, pipeline continues with remaining repos."""

    def test_repo_failure_continues_pipeline(self, workspace, mock_dynamo):
        """When one repo's ATX fails, the pipeline continues and dependents
        get a failure note in their context.
        """
        mock_dynamodb, mock_table = mock_dynamo
        app_id, run_id = "app-4", "run-4"
        work_dir = workspace / app_id / run_id
        work_dir.mkdir(parents=True)

        # 3 repos: infra → database → api
        # database will fail
        _make_repo(work_dir, "infra", {
            "main.tf": textwrap.dedent("""\
                resource "aws_vpc" "main" {
                  cidr_block = "10.0.0.0/16"
                }
            """),
        })
        _make_repo(work_dir, "database", {
            "requirements.txt": "alembic==1.12.0\nsqlalchemy==2.0.0\n",
            "main.tf": textwrap.dedent("""\
                module "vpc" {
                  source = "../infra"
                }
            """),
        })
        _make_repo(work_dir, "api", {
            "package.json": json.dumps({
                "name": "api",
                "dependencies": {"database": "^1.0.0", "express": "^4.18.0"},
            }),
        })

        analyzed_repos: List[str] = []

        def mock_run_atx(repo_dir, config_path=None):
            repo_name = Path(repo_dir).name
            analyzed_repos.append(repo_name)
            if repo_name == "database":
                # Simulate failure for database repo
                return {
                    "success": False,
                    "error": "ATX CLI crashed",
                    "conversation_id": None,
                    "resumable": False,
                }
            _make_atx_docs(repo_dir, f"{repo_name}: analysis complete")
            return {"success": True, "conversation_id": f"conv-{repo_name}", "returncode": 0}

        result = _run_combined_with_workspace(
            workspace=workspace,
            repo_urls=[
                "https://github.com/org/infra.git",
                "https://github.com/org/database.git",
                "https://github.com/org/api.git",
            ],
            mock_dynamodb=mock_dynamodb,
            mock_run_atx=mock_run_atx,
            app_id=app_id,
            run_id=run_id,
        )

        # Pipeline continued — all 3 repos were attempted
        assert set(analyzed_repos) == {"infra", "database", "api"}

        # 2 succeeded, 1 failed
        assert result["completed_repos"] == 2
        assert result["failed_repos"] == 1
        assert result["success"] is False  # overall success is False when any repo fails

        # Verify per-repo results
        results_by_name = {r["repo_name"]: r for r in result["results"]}
        assert results_by_name["infra"]["success"] is True
        assert results_by_name["database"]["success"] is False
        assert results_by_name["database"]["error"] == "ATX CLI crashed"
        assert results_by_name["api"]["success"] is True

        # Failed repo has a failure note in summaries (for context chaining)
        assert "FAILED" in result["repo_summaries"]["database"]

        # Execution order still respects dependencies
        order = result["execution_order"]
        assert order.index("infra") < order.index("database")
        assert order.index("database") < order.index("api")
