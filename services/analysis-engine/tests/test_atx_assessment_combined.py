"""Tests for ATXAssessmentService.process_combined_results() and helpers."""
import json
from datetime import datetime
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

from app.services.atx_assessment_service import ATXAssessmentService


# ── Fixtures ────────────────────────────────────────────────────

def _make_repo_assessment(
    repo_name: str,
    languages: List[str] | None = None,
    frameworks: List[str] | None = None,
    deps: List[Dict[str, Any]] | None = None,
    security: Dict[str, Any] | None = None,
    technical_debt: Dict[str, Any] | None = None,
    migration_plan: List[Dict[str, Any]] | None = None,
    summary: str = "",
) -> Dict[str, Any]:
    """Build a minimal per-repo assessment dict for testing."""
    return {
        "repo_name": repo_name,
        "current_state": {
            "languages": languages or [],
            "frameworks": frameworks or [],
            "build_tools": [],
            "databases": [],
        },
        "dependencies": deps or [],
        "security": security or {
            "iam_violations_count": 0,
            "credential_issues": [],
            "network_gaps": [],
            "vulnerabilities_by_severity": [],
            "eol_component_count": 0,
        },
        "technical_debt": technical_debt or {
            "critical": [],
            "high": [],
            "medium": [],
            "low": [],
        },
        "migration_plan": migration_plan or [],
        "summary": summary,
    }


@pytest.fixture
def service():
    """Create an ATXAssessmentService with mocked config."""
    with patch("app.services.atx_assessment_service.Config") as mock_cfg:
        mock_cfg.ATX_ASSESSMENTS_TABLE = "test-assessments"
        mock_cfg.S3_ARA_BUCKET = "test-bucket"
        mock_cfg.BEDROCK_MODEL_ID = "test-model"
        svc = ATXAssessmentService()
    return svc


# ── Unit tests: _aggregate_assessments ──────────────────────────

class TestAggregateAssessments:
    """Tests for _aggregate_assessments merging logic."""

    def test_merges_languages_across_repos(self, service):
        repos = [
            _make_repo_assessment("infra", languages=["HCL", "Python"]),
            _make_repo_assessment("backend", languages=["Java", "Python"]),
            _make_repo_assessment("frontend", languages=["TypeScript"]),
        ]
        result = service._aggregate_assessments(repos)
        langs = result["current_state"]["languages"]
        assert "HCL" in langs
        assert "Java" in langs
        assert "TypeScript" in langs
        assert "Python" in langs
        # Python should appear only once (deduped)
        assert langs.count("Python") == 1

    def test_merges_frameworks_deduped(self, service):
        repos = [
            _make_repo_assessment("a", frameworks=["Spring Boot"]),
            _make_repo_assessment("b", frameworks=["Spring Boot", "React"]),
        ]
        result = service._aggregate_assessments(repos)
        fws = result["current_state"]["frameworks"]
        assert fws.count("Spring Boot") == 1
        assert "React" in fws

    def test_aggregates_dependencies_with_source_repo(self, service):
        repos = [
            _make_repo_assessment("backend", deps=[
                {"name": "spring-core", "version": "5.3", "health": "current"},
            ]),
            _make_repo_assessment("frontend", deps=[
                {"name": "react", "version": "18.2", "health": "current"},
            ]),
        ]
        result = service._aggregate_assessments(repos)
        all_deps = result["dependencies"]
        assert len(all_deps) == 2
        assert all_deps[0]["source_repo"] == "backend"
        assert all_deps[1]["source_repo"] == "frontend"

    def test_aggregates_security_counts(self, service):
        repos = [
            _make_repo_assessment("a", security={
                "iam_violations_count": 3,
                "credential_issues": ["hardcoded key"],
                "network_gaps": ["open port 22"],
                "vulnerabilities_by_severity": [
                    {"severity": "critical", "count": 2},
                    {"severity": "high", "count": 5},
                ],
                "eol_component_count": 1,
            }),
            _make_repo_assessment("b", security={
                "iam_violations_count": 1,
                "credential_issues": ["env var leak"],
                "network_gaps": [],
                "vulnerabilities_by_severity": [
                    {"severity": "critical", "count": 1},
                    {"severity": "medium", "count": 3},
                ],
                "eol_component_count": 2,
            }),
        ]
        result = service._aggregate_assessments(repos)
        sec = result["security"]
        assert sec["iam_violations_count"] == 4
        assert len(sec["credential_issues"]) == 2
        assert sec["eol_component_count"] == 3
        # Vulns should be summed by severity
        vulns = {v["severity"]: v["count"] for v in sec["vulnerabilities_by_severity"]}
        assert vulns["critical"] == 3
        assert vulns["high"] == 5
        assert vulns["medium"] == 3

    def test_aggregates_technical_debt_with_source_repo(self, service):
        repos = [
            _make_repo_assessment("infra", technical_debt={
                "critical": [{"item": "outdated TF", "component": "main.tf"}],
                "high": [],
                "medium": [],
                "low": [],
            }),
            _make_repo_assessment("backend", technical_debt={
                "critical": [],
                "high": [{"item": "Java 8 EOL", "component": "pom.xml"}],
                "medium": [{"item": "unused import", "component": "App.java"}],
                "low": [],
            }),
        ]
        result = service._aggregate_assessments(repos)
        td = result["technical_debt"]
        assert len(td["critical"]) == 1
        assert td["critical"][0]["source_repo"] == "infra"
        assert len(td["high"]) == 1
        assert td["high"][0]["source_repo"] == "backend"
        assert len(td["medium"]) == 1

    def test_skips_repos_with_errors(self, service):
        repos = [
            _make_repo_assessment("good", languages=["Java"]),
            {"repo_name": "bad", "error": "No content"},
        ]
        result = service._aggregate_assessments(repos)
        assert result["current_state"]["languages"] == ["Java"]

    def test_empty_repo_list(self, service):
        result = service._aggregate_assessments([])
        assert result["current_state"]["languages"] == []
        assert result["dependencies"] == []
        assert result["security"]["iam_violations_count"] == 0


# ── Unit tests: _infer_repo_roles ───────────────────────────────

class TestInferRepoRoles:
    """Tests for _infer_repo_roles."""

    def test_uses_ai_summary_when_available(self):
        repos = [
            _make_repo_assessment("infra", summary="Terraform CDK infrastructure provisioning"),
        ]
        roles = ATXAssessmentService._infer_repo_roles(repos, {})
        assert "Terraform" in roles["infra"]

    def test_falls_back_to_repo_summaries(self):
        repos = [_make_repo_assessment("db", summary="")]
        summaries = {"db": "Flyway database migrations for PostgreSQL 14"}
        roles = ATXAssessmentService._infer_repo_roles(repos, summaries)
        assert "Flyway" in roles["db"]

    def test_no_description_available(self):
        repos = [_make_repo_assessment("unknown", summary="")]
        roles = ATXAssessmentService._infer_repo_roles(repos, {})
        assert roles["unknown"] == "No description available"

    def test_truncates_long_summaries(self):
        long_summary = "A" * 300
        repos = [_make_repo_assessment("repo", summary=long_summary)]
        roles = ATXAssessmentService._infer_repo_roles(repos, {})
        assert len(roles["repo"]) == 200


# ── Unit tests: _build_ordered_migration_plan ───────────────────

class TestBuildOrderedMigrationPlan:
    """Tests for _build_ordered_migration_plan."""

    def test_respects_execution_order(self):
        repos = [
            _make_repo_assessment("infra", migration_plan=[
                {"phase_name": "Upgrade Terraform", "items": 3},
            ]),
            _make_repo_assessment("backend", migration_plan=[
                {"phase_name": "Upgrade Java", "items": 5},
            ]),
            _make_repo_assessment("frontend", migration_plan=[
                {"phase_name": "Upgrade React", "items": 2},
            ]),
        ]
        order = ["infra", "backend", "frontend"]
        roles = {"infra": "Infrastructure", "backend": "Backend API", "frontend": "Frontend"}

        plan = ATXAssessmentService._build_ordered_migration_plan(repos, order, roles)
        assert len(plan) == 3
        assert plan[0]["repo_name"] == "infra"
        assert plan[0]["phase"] == 1
        assert plan[1]["repo_name"] == "backend"
        assert plan[1]["phase"] == 2
        assert plan[2]["repo_name"] == "frontend"
        assert plan[2]["phase"] == 3

    def test_includes_depends_on(self):
        repos = [
            _make_repo_assessment("infra"),
            _make_repo_assessment("backend"),
            _make_repo_assessment("frontend"),
        ]
        order = ["infra", "backend", "frontend"]
        roles = {"infra": "Infra", "backend": "Backend", "frontend": "Frontend"}

        plan = ATXAssessmentService._build_ordered_migration_plan(repos, order, roles)
        assert plan[0]["depends_on"] == []
        assert plan[1]["depends_on"] == ["infra"]
        assert plan[2]["depends_on"] == ["infra", "backend"]

    def test_includes_per_repo_steps(self):
        repos = [
            _make_repo_assessment("api", migration_plan=[
                {"phase_name": "Step 1", "items": 2},
                {"phase_name": "Step 2", "items": 4},
            ]),
        ]
        plan = ATXAssessmentService._build_ordered_migration_plan(
            repos, ["api"], {"api": "API"},
        )
        assert len(plan[0]["steps"]) == 2

    def test_empty_execution_order(self):
        plan = ATXAssessmentService._build_ordered_migration_plan([], [], {})
        assert plan == []


# ── Unit tests: _build_combined_summary ─────────────────────────

class TestBuildCombinedSummary:
    """Tests for _build_combined_summary."""

    def test_includes_repo_count(self):
        repos = [
            _make_repo_assessment("a", languages=["Java"]),
            _make_repo_assessment("b", languages=["Python"]),
        ]
        aggregated = ATXAssessmentService._aggregate_assessments(
            ATXAssessmentService(), repos,
        )
        summary = ATXAssessmentService._build_combined_summary(
            repos, ["a", "b"], aggregated,
        )
        assert "2 repositories" in summary
        assert "2 successful" in summary

    def test_mentions_tech_debt_when_present(self):
        repos = [
            _make_repo_assessment("a", technical_debt={
                "critical": [{"item": "x", "component": "y"}],
                "high": [{"item": "z", "component": "w"}],
                "medium": [],
                "low": [],
            }),
        ]
        aggregated = ATXAssessmentService._aggregate_assessments(
            ATXAssessmentService(), repos,
        )
        summary = ATXAssessmentService._build_combined_summary(
            repos, ["a"], aggregated,
        )
        assert "1 critical" in summary
        assert "1 high" in summary


# ── Integration tests: process_combined_results ─────────────────

class TestProcessCombinedResults:
    """Integration tests for the full process_combined_results pipeline."""

    def _mock_ai_response(self, repo_name: str) -> Dict[str, Any]:
        """Return a realistic AI extraction result for a given repo."""
        if repo_name == "infra":
            return {
                "current_state": {
                    "languages": ["HCL"],
                    "frameworks": ["Terraform CDK"],
                    "build_tools": ["terraform"],
                    "databases": [],
                },
                "dependencies": [
                    {"name": "aws", "version": "4.0", "health": "current", "category": "terraform"},
                ],
                "security": {
                    "iam_violations_count": 2,
                    "credential_issues": ["overly permissive IAM role"],
                    "network_gaps": [],
                    "vulnerabilities_by_severity": [{"severity": "high", "count": 1}],
                    "eol_component_count": 0,
                },
                "technical_debt": {
                    "critical": [],
                    "high": [{"item": "Terraform 0.12", "component": "main.tf", "category": "upgrade"}],
                    "medium": [],
                    "low": [],
                },
                "migration_plan": [
                    {"phase_name": "Upgrade Terraform", "items": 3, "priority": "high"},
                ],
                "summary": "Terraform CDK infrastructure provisioning for ECS Fargate and RDS.",
            }
        elif repo_name == "backend":
            return {
                "current_state": {
                    "languages": ["Java 11"],
                    "frameworks": ["Spring Boot 2.7"],
                    "build_tools": ["Maven"],
                    "databases": ["PostgreSQL 14"],
                },
                "dependencies": [
                    {"name": "spring-boot", "version": "2.7.0", "health": "outdated", "category": "maven"},
                ],
                "security": {
                    "iam_violations_count": 0,
                    "credential_issues": [],
                    "network_gaps": ["open DB port"],
                    "vulnerabilities_by_severity": [{"severity": "critical", "count": 2}],
                    "eol_component_count": 1,
                },
                "technical_debt": {
                    "critical": [{"item": "Java 11 EOL", "component": "pom.xml", "category": "upgrade"}],
                    "high": [],
                    "medium": [],
                    "low": [],
                },
                "migration_plan": [
                    {"phase_name": "Upgrade Java", "items": 5, "priority": "critical"},
                ],
                "summary": "Spring Boot 2.7 backend with JPA entities and REST API.",
            }
        return {}

    @patch("app.services.atx_assessment_service.Config")
    def test_full_pipeline(self, mock_config):
        """End-to-end test: reads S3, extracts per-repo, aggregates, stores."""
        mock_config.ATX_ASSESSMENTS_TABLE = "test-table"
        mock_config.S3_ARA_BUCKET = "test-bucket"
        mock_config.BEDROCK_MODEL_ID = "test-model"

        svc = ATXAssessmentService()

        # Mock _read_s3_files to return content per repo
        def mock_read_s3(prefix: str) -> str:
            if "infra" in prefix:
                return "# Infrastructure\nTerraform CDK project"
            if "backend" in prefix:
                return "# Backend\nSpring Boot application"
            return ""

        # Mock _extract_with_ai to return structured data
        call_count = {"n": 0}
        repo_order = ["infra", "backend"]

        def mock_extract(content: str) -> Dict[str, Any]:
            idx = call_count["n"]
            call_count["n"] += 1
            repo = repo_order[idx] if idx < len(repo_order) else "unknown"
            return self._mock_ai_response(repo)

        # Mock DynamoDB
        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table
        mock_config.get_boto3_resource.return_value = mock_dynamo

        svc._read_s3_files = mock_read_s3
        svc._extract_with_ai = mock_extract

        result = svc.process_combined_results(
            app_id="app-123",
            run_id="run-456",
            repo_s3_prefixes={
                "infra": "app-123/run-456_infra/",
                "backend": "app-123/run-456_backend/",
            },
            dependency_data={
                "execution_order": ["infra", "backend"],
                "dependency_graph": {"backend": ["infra"], "infra": []},
                "mermaid_diagram": "graph TD\n  infra --> backend",
                "repo_summaries": {
                    "infra": "Terraform CDK, ECS Fargate",
                    "backend": "Spring Boot 2.7, Java 11",
                },
            },
        )

        assert result["success"] is True
        assert result["repo_name"] == "combined-phased"
        assert result["repos_processed"] == 2
        assert result["repos_failed"] == 0

        # Verify DynamoDB put_item was called
        mock_table.put_item.assert_called_once()
        stored_item = mock_table.put_item.call_args[1]["Item"]
        assert stored_item["repo_name"] == "combined-phased"
        assert stored_item["application_id"] == "app-123"

        # Verify aggregated data in stored item
        aggregated = json.loads(stored_item["aggregated"])
        assert "HCL" in aggregated["current_state"]["languages"]
        assert "Java 11" in aggregated["current_state"]["languages"]
        assert aggregated["security"]["iam_violations_count"] == 2

        # Verify dependency_analysis
        dep_analysis = json.loads(stored_item["dependency_analysis"])
        assert dep_analysis["execution_order"] == ["infra", "backend"]
        assert "infra" in dep_analysis["repo_roles"]

        # Verify migration_plan respects order
        plan = json.loads(stored_item["migration_plan"])
        assert plan[0]["repo_name"] == "infra"
        assert plan[0]["phase"] == 1
        assert plan[1]["repo_name"] == "backend"
        assert plan[1]["phase"] == 2

    @patch("app.services.atx_assessment_service.Config")
    def test_handles_missing_repo_content(self, mock_config):
        """Repos with no S3 content are marked with error but don't break pipeline."""
        mock_config.ATX_ASSESSMENTS_TABLE = "test-table"
        mock_config.S3_ARA_BUCKET = "test-bucket"
        mock_config.BEDROCK_MODEL_ID = "test-model"

        svc = ATXAssessmentService()
        svc._read_s3_files = lambda prefix: ""  # No content for any repo

        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table
        mock_config.get_boto3_resource.return_value = mock_dynamo

        result = svc.process_combined_results(
            app_id="app-123",
            run_id="run-789",
            repo_s3_prefixes={"infra": "prefix/infra/", "backend": "prefix/backend/"},
            dependency_data={
                "execution_order": ["infra", "backend"],
                "dependency_graph": {},
                "mermaid_diagram": "",
                "repo_summaries": {},
            },
        )

        assert result["success"] is True
        assert result["repos_processed"] == 0
        assert result["repos_failed"] == 2

    @patch("app.services.atx_assessment_service.Config")
    def test_handles_missing_s3_prefix(self, mock_config):
        """Repos not in repo_s3_prefixes are skipped gracefully."""
        mock_config.ATX_ASSESSMENTS_TABLE = "test-table"
        mock_config.S3_ARA_BUCKET = "test-bucket"
        mock_config.BEDROCK_MODEL_ID = "test-model"

        svc = ATXAssessmentService()
        svc._read_s3_files = lambda prefix: "# Content"
        svc._extract_with_ai = lambda content: _make_repo_assessment("infra")

        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table
        mock_config.get_boto3_resource.return_value = mock_dynamo

        result = svc.process_combined_results(
            app_id="app-123",
            run_id="run-000",
            repo_s3_prefixes={"infra": "prefix/infra/"},  # backend missing
            dependency_data={
                "execution_order": ["infra", "backend"],
                "dependency_graph": {},
                "mermaid_diagram": "",
                "repo_summaries": {},
            },
        )

        assert result["repos_processed"] == 1
        assert result["repos_failed"] == 1

    @patch("app.services.atx_assessment_service.Config")
    def test_store_combined_assessment_item_shape(self, mock_config):
        """Verify the DynamoDB item has the expected keys."""
        mock_config.ATX_ASSESSMENTS_TABLE = "test-table"
        mock_config.S3_ARA_BUCKET = "test-bucket"
        mock_config.BEDROCK_MODEL_ID = None  # no AI

        svc = ATXAssessmentService()

        mock_table = MagicMock()
        mock_dynamo = MagicMock()
        mock_dynamo.Table.return_value = mock_table
        mock_config.get_boto3_resource.return_value = mock_dynamo

        data = {
            "repos": [{"repo_name": "a"}],
            "dependency_analysis": {"execution_order": ["a"]},
            "aggregated": {
                "current_state": {"languages": ["Java"]},
                "dependencies": [],
                "security": {},
                "technical_debt": {},
            },
            "migration_plan": [{"phase": 1, "repo_name": "a"}],
            "summary": "Test summary",
        }

        svc._store_combined_assessment("app-1", "run-1", data)

        mock_table.put_item.assert_called_once()
        item = mock_table.put_item.call_args[1]["Item"]
        assert item["application_id"] == "app-1"
        assert item["repo_run_key"] == "run-1#combined-phased"
        assert item["repo_name"] == "combined-phased"
        assert item["summary"] == "Test summary"
        # JSON-serialized fields
        assert json.loads(item["repos"]) == [{"repo_name": "a"}]
        assert json.loads(item["current_state"]) == {"languages": ["Java"]}
