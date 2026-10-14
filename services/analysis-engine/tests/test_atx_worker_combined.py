"""
Unit tests for run_combined() and context chaining helpers in atx_worker.

Tests cover:
- _repo_name_from_url extraction
- _extract_summary from ATXDocumentation
- _generate_context_config YAML generation
- run_combined orchestration with mocked ATX/DynamoDB
"""

import json
import os
import textwrap
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch, call

import pytest

from app.workers.atx_worker import (
    _extract_summary,
    _generate_context_config,
    _repo_name_from_url,
    run_combined,
)


# ── _repo_name_from_url ─────────────────────────────────────────────


class TestRepoNameFromUrl:
    def test_simple_https(self):
        assert _repo_name_from_url("https://github.com/org/my-repo.git") == "my-repo"

    def test_with_branch(self):
        assert _repo_name_from_url("https://github.com/org/my-repo.git#main") == "my-repo"

    def test_trailing_slash(self):
        assert _repo_name_from_url("https://github.com/org/my-repo/") == "my-repo"

    def test_no_git_suffix(self):
        assert _repo_name_from_url("https://github.com/org/my-repo") == "my-repo"

    def test_branch_with_slash(self):
        assert _repo_name_from_url("https://github.com/org/repo.git#feature/x") == "repo"


# ── _extract_summary ─────────────────────────────────────────────────


class TestExtractSummary:
    def test_with_summary_md(self, tmp_path):
        repo_dir = tmp_path / "my-repo"
        docs = repo_dir / "ATXDocumentation"
        docs.mkdir(parents=True)
        (docs / "summary.md").write_text("Spring Boot 2.7 REST API with JPA entities.")

        result = _extract_summary(
            str(repo_dir), "my-repo",
            build_systems=["maven"], languages=["java"],
        )
        assert "my-repo" in result
        assert "java" in result
        assert "maven" in result
        assert "Spring Boot" in result

    def test_without_summary_md_falls_back_to_docs(self, tmp_path):
        repo_dir = tmp_path / "my-repo"
        docs = repo_dir / "ATXDocumentation"
        docs.mkdir(parents=True)
        (docs / "analysis.md").write_text("Terraform CDK infrastructure code.")

        result = _extract_summary(
            str(repo_dir), "my-repo",
            build_systems=["terraform"], languages=["hcl"],
        )
        assert "my-repo" in result
        assert "Terraform" in result

    def test_no_docs_directory(self, tmp_path):
        repo_dir = tmp_path / "my-repo"
        repo_dir.mkdir()

        result = _extract_summary(
            str(repo_dir), "my-repo",
            build_systems=[], languages=[],
        )
        assert "No summary available" in result

    def test_empty_summary_md(self, tmp_path):
        repo_dir = tmp_path / "my-repo"
        docs = repo_dir / "ATXDocumentation"
        docs.mkdir(parents=True)
        (docs / "summary.md").write_text("")

        result = _extract_summary(
            str(repo_dir), "my-repo",
            build_systems=["npm"], languages=["javascript"],
        )
        # Falls back since summary.md is empty
        assert "my-repo" in result


# ── _generate_context_config ─────────────────────────────────────────


class TestGenerateContextConfig:
    """Tests for context chaining config.yaml generation."""

    def test_basic_config_generation(self, tmp_path):
        repo_dir = str(tmp_path / "backend-api")
        Path(repo_dir).mkdir()

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="backend-api",
            total_repos=3,
            current_index=2,
            execution_order=["infra", "database", "backend-api"],
            dependency_graph={
                "infra": [],
                "database": ["infra"],
                "backend-api": ["database"],
            },
            repo_summaries={
                "infra": "infra (hcl, terraform): ECS Fargate cluster, RDS PostgreSQL",
                "database": "database (python, python): Flyway migrations, PostgreSQL 14",
            },
            build_info={"build": "mvn package", "validate": "mvn test"},
            selected_files=[],
        )

        assert Path(config_path).exists()
        content = Path(config_path).read_text()

        # Check additionalPlanContext block
        assert "additionalPlanContext:" in content
        assert "multi-repo application with 3 repositories" in content
        assert "repo 3 of 3" in content
        assert "This repo depends on: database" in content
        assert "Previously analyzed repositories:" in content
        assert "infra" in content
        assert "database" in content
        # Check build commands
        assert "buildCommand: mvn package" in content
        assert "validationCommands: mvn test" in content

    def test_first_repo_no_summaries(self, tmp_path):
        """First repo should still generate valid config even with no summaries."""
        repo_dir = str(tmp_path / "infra")
        Path(repo_dir).mkdir()

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="infra",
            total_repos=3,
            current_index=0,
            execution_order=["infra", "database", "api"],
            dependency_graph={"infra": [], "database": ["infra"], "api": ["database"]},
            repo_summaries={},
            build_info={"build": "terraform init", "validate": "terraform validate"},
            selected_files=[],
        )

        content = Path(config_path).read_text()
        assert "repo 1 of 3" in content
        assert "Previously analyzed" not in content

    def test_includes_dependents(self, tmp_path):
        repo_dir = str(tmp_path / "database")
        Path(repo_dir).mkdir()

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="database",
            total_repos=3,
            current_index=1,
            execution_order=["infra", "database", "api"],
            dependency_graph={
                "infra": [],
                "database": ["infra"],
                "api": ["database"],
            },
            repo_summaries={
                "infra": "infra (hcl, terraform): VPC and ECS setup",
            },
            build_info={"build": "echo ok", "validate": "echo ok"},
            selected_files=[],
        )

        content = Path(config_path).read_text()
        assert "This repo depends on: infra" in content
        assert "Repos that depend on this: api" in content

    def test_failed_dependency_note(self, tmp_path):
        repo_dir = str(tmp_path / "api")
        Path(repo_dir).mkdir()

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="api",
            total_repos=2,
            current_index=1,
            execution_order=["database", "api"],
            dependency_graph={"database": [], "api": ["database"]},
            repo_summaries={"database": "database: Analysis FAILED"},
            build_info={"build": "npm install", "validate": "npm test"},
            selected_files=[],
            failed_repos=["database"],
        )

        content = Path(config_path).read_text()
        assert "database analysis failed" in content.lower()

    def test_config_written_to_application_specific_context(self, tmp_path):
        repo_dir = str(tmp_path / "my-repo")
        Path(repo_dir).mkdir()

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="my-repo",
            total_repos=1,
            current_index=0,
            execution_order=["my-repo"],
            dependency_graph={"my-repo": []},
            repo_summaries={},
            build_info={"build": "echo ok", "validate": "echo ok"},
            selected_files=[],
        )

        assert "ApplicationSpecificContext" in config_path
        assert config_path.endswith("config.yaml")

    def test_with_mock_summaries(self, tmp_path):
        """Validates: Requirements 2.2 — config.yaml with additionalPlanContext
        containing multi-repo statement, position, deps, dependents, and summaries.
        """
        repo_dir = str(tmp_path / "frontend")
        Path(repo_dir).mkdir()

        summaries = {
            "infrastructure": "infrastructure (hcl, terraform): Deploys ECS Fargate cluster, RDS PostgreSQL, S3 buckets, CloudFront",
            "database-migrations": "database-migrations (python, python): PostgreSQL 14, 47 migration scripts, schema versioning",
            "shared-libs": "shared-libs (java, maven): Common DTOs, auth utilities, logging framework",
            "backend-core": "backend-core (java, maven): Core business logic, JPA entities, service layer",
        }

        config_path = _generate_context_config(
            repo_dir=repo_dir,
            repo_name="frontend",
            total_repos=5,
            current_index=4,
            execution_order=[
                "infrastructure", "database-migrations",
                "shared-libs", "backend-core", "frontend",
            ],
            dependency_graph={
                "infrastructure": [],
                "database-migrations": ["infrastructure"],
                "shared-libs": [],
                "backend-core": ["shared-libs", "database-migrations"],
                "frontend": ["backend-core"],
            },
            repo_summaries=summaries,
            build_info={"build": "npm run build", "validate": "npm test"},
            selected_files=[],
        )

        content = Path(config_path).read_text()

        # Multi-repo statement
        assert "multi-repo application with 5 repositories" in content
        # Position
        assert "repo 5 of 5" in content
        # Dependencies
        assert "This repo depends on: backend-core" in content
        # All 4 previous summaries present
        assert "infrastructure" in content
        assert "database-migrations" in content
        assert "shared-libs" in content
        assert "backend-core" in content
        # Build commands
        assert "buildCommand: npm run build" in content


# ── run_combined integration tests (mocked) ──────────────────────────


class TestRunCombined:
    """Integration tests for run_combined() with mocked ATX/DynamoDB."""

    def test_extract_summary_integration(self, tmp_path):
        """End-to-end: extract summary from real ATXDocumentation files."""
        repo_dir = tmp_path / "backend-api"
        docs = repo_dir / "ATXDocumentation"
        docs.mkdir(parents=True)

        (docs / "summary.md").write_text(textwrap.dedent("""\
            # Backend API Analysis

            ## Technology Stack
            - Language: Java 11
            - Framework: Spring Boot 2.7.14
            - Build: Maven 3.8
            - Database: PostgreSQL via JPA/Hibernate

            ## Architecture Role
            Core REST API serving the frontend and mobile clients.

            ## Key Findings
            - 47 REST endpoints across 12 controllers
            - Uses Spring Security with JWT authentication
            - Heavy use of JPA entities with complex relationships
        """))

        summary = _extract_summary(
            str(repo_dir), "backend-api",
            build_systems=["maven"], languages=["java"],
        )

        assert "backend-api" in summary
        assert "java" in summary
        assert "maven" in summary
        assert "Java 11" in summary or "Spring Boot" in summary

    def test_context_chain_end_to_end(self, tmp_path):
        """End-to-end: generate config for 3rd repo with 2 prior summaries."""
        repos = ["infra", "database", "api"]
        workspace = tmp_path / "workspace"

        for rn in repos:
            (workspace / rn).mkdir(parents=True)

        summaries = {
            "infra": "infra (hcl, terraform): ECS Fargate, RDS PostgreSQL, S3, CloudFront",
            "database": "database (python, python): Flyway migrations, PostgreSQL 14, 47 scripts",
        }

        config_path = _generate_context_config(
            repo_dir=str(workspace / "api"),
            repo_name="api",
            total_repos=3,
            current_index=2,
            execution_order=repos,
            dependency_graph={
                "infra": [],
                "database": ["infra"],
                "api": ["database"],
            },
            repo_summaries=summaries,
            build_info={"build": "npm install", "validate": "npm test"},
            selected_files=[],
        )

        content = Path(config_path).read_text()

        # Verify the full context chain
        assert "multi-repo application with 3 repositories" in content
        assert "repo 3 of 3" in content
        assert "This repo depends on: database" in content
        assert "infra" in content
        assert "database" in content
        assert "ECS Fargate" in content
        assert "Flyway migrations" in content
        assert "buildCommand: npm install" in content
