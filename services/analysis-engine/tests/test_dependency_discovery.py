"""
Unit tests for DependencyDiscoveryService — build file parsers.

Each test creates sample build file content in a temporary directory
and verifies the parser extracts the correct dependencies.
"""

import json
import os
import textwrap
from pathlib import Path

import pytest

from app.services.dependency_discovery import (
    Dependency,
    DependencyDiscoveryService,
    DiscoveryResult,
    RepoMetadata,
)


@pytest.fixture
def service():
    """Create a fresh DependencyDiscoveryService instance."""
    return DependencyDiscoveryService()


# ── Dataclass tests ──────────────────────────────────────────────────


class TestDataclasses:
    def test_dependency_fields(self):
        dep = Dependency(name="spring-boot", version="2.7.0", dep_type="maven", source_file="pom.xml")
        assert dep.name == "spring-boot"
        assert dep.version == "2.7.0"
        assert dep.dep_type == "maven"
        assert dep.source_file == "pom.xml"

    def test_repo_metadata_defaults(self):
        meta = RepoMetadata(name="my-repo")
        assert meta.name == "my-repo"
        assert meta.languages == []
        assert meta.build_systems == []
        assert meta.dependencies == []

    def test_discovery_result_fields(self):
        result = DiscoveryResult(
            dependency_graph={"a": ["b"]},
            execution_order=["b", "a"],
            mermaid_diagram="graph TD",
            repo_metadata={},
            cycles_detected=[],
        )
        assert result.dependency_graph == {"a": ["b"]}
        assert result.execution_order == ["b", "a"]


# ── Maven pom.xml tests ─────────────────────────────────────────────


class TestParsePomXml:
    def test_basic_dependencies(self, service, tmp_path):
        pom_content = textwrap.dedent("""\
            <?xml version="1.0" encoding="UTF-8"?>
            <project xmlns="http://maven.apache.org/POM/4.0.0">
                <groupId>com.example</groupId>
                <artifactId>my-app</artifactId>
                <version>1.0.0</version>
                <dependencies>
                    <dependency>
                        <groupId>org.springframework.boot</groupId>
                        <artifactId>spring-boot-starter-web</artifactId>
                        <version>2.7.0</version>
                    </dependency>
                    <dependency>
                        <groupId>com.example</groupId>
                        <artifactId>shared-lib</artifactId>
                        <version>1.0.0</version>
                    </dependency>
                </dependencies>
            </project>
        """)
        pom_file = tmp_path / "pom.xml"
        pom_file.write_text(pom_content)

        deps = service._parse_pom_xml(str(pom_file))
        assert len(deps) == 2
        assert deps[0].name == "org.springframework.boot:spring-boot-starter-web"
        assert deps[0].version == "2.7.0"
        assert deps[0].dep_type == "maven"
        assert deps[1].name == "com.example:shared-lib"

    def test_no_namespace(self, service, tmp_path):
        pom_content = textwrap.dedent("""\
            <?xml version="1.0"?>
            <project>
                <dependencies>
                    <dependency>
                        <groupId>junit</groupId>
                        <artifactId>junit</artifactId>
                        <version>4.13</version>
                    </dependency>
                </dependencies>
            </project>
        """)
        pom_file = tmp_path / "pom.xml"
        pom_file.write_text(pom_content)

        deps = service._parse_pom_xml(str(pom_file))
        assert len(deps) == 1
        assert deps[0].name == "junit:junit"

    def test_missing_version(self, service, tmp_path):
        pom_content = textwrap.dedent("""\
            <?xml version="1.0"?>
            <project xmlns="http://maven.apache.org/POM/4.0.0">
                <dependencies>
                    <dependency>
                        <groupId>com.example</groupId>
                        <artifactId>no-version</artifactId>
                    </dependency>
                </dependencies>
            </project>
        """)
        pom_file = tmp_path / "pom.xml"
        pom_file.write_text(pom_content)

        deps = service._parse_pom_xml(str(pom_file))
        assert len(deps) == 1
        assert deps[0].version == ""

    def test_invalid_xml(self, service, tmp_path):
        pom_file = tmp_path / "pom.xml"
        pom_file.write_text("not valid xml <><>")

        deps = service._parse_pom_xml(str(pom_file))
        assert deps == []


# ── npm package.json tests ───────────────────────────────────────────


class TestParsePackageJson:
    def test_dependencies_and_dev_dependencies(self, service, tmp_path):
        pkg = {
            "name": "my-frontend",
            "version": "1.0.0",
            "dependencies": {
                "react": "^18.2.0",
                "axios": "~1.4.0",
            },
            "devDependencies": {
                "jest": "^29.0.0",
            },
        }
        pkg_file = tmp_path / "package.json"
        pkg_file.write_text(json.dumps(pkg))

        deps = service._parse_package_json(str(pkg_file))
        assert len(deps) == 3
        names = {d.name for d in deps}
        assert names == {"react", "axios", "jest"}
        assert all(d.dep_type == "npm" for d in deps)

    def test_empty_dependencies(self, service, tmp_path):
        pkg = {"name": "empty-app", "version": "1.0.0"}
        pkg_file = tmp_path / "package.json"
        pkg_file.write_text(json.dumps(pkg))

        deps = service._parse_package_json(str(pkg_file))
        assert deps == []

    def test_invalid_json(self, service, tmp_path):
        pkg_file = tmp_path / "package.json"
        pkg_file.write_text("{invalid json")

        deps = service._parse_package_json(str(pkg_file))
        assert deps == []


# ── Gradle tests ─────────────────────────────────────────────────────


class TestParseGradle:
    def test_implementation_dependencies(self, service, tmp_path):
        gradle_content = textwrap.dedent("""\
            plugins {
                id 'java'
            }
            dependencies {
                implementation 'org.springframework.boot:spring-boot-starter:2.7.0'
                api 'com.google.guava:guava:31.1-jre'
                testImplementation 'junit:junit:4.13.2'
            }
        """)
        gradle_file = tmp_path / "build.gradle"
        gradle_file.write_text(gradle_content)

        deps = service._parse_gradle(str(gradle_file))
        assert len(deps) == 3
        assert deps[0].name == "org.springframework.boot:spring-boot-starter"
        assert deps[0].version == "2.7.0"
        assert deps[1].name == "com.google.guava:guava"
        assert deps[1].version == "31.1-jre"

    def test_kotlin_dsl(self, service, tmp_path):
        gradle_content = textwrap.dedent("""\
            dependencies {
                implementation("org.jetbrains.kotlin:kotlin-stdlib:1.8.0")
                runtimeOnly("com.h2database:h2:2.1.214")
            }
        """)
        gradle_file = tmp_path / "build.gradle.kts"
        gradle_file.write_text(gradle_content)

        deps = service._parse_gradle(str(gradle_file))
        assert len(deps) == 2
        assert deps[0].name == "org.jetbrains.kotlin:kotlin-stdlib"

    def test_project_dependencies(self, service, tmp_path):
        gradle_content = textwrap.dedent("""\
            dependencies {
                implementation project(':core-lib')
                implementation project(":shared-utils")
            }
        """)
        gradle_file = tmp_path / "build.gradle"
        gradle_file.write_text(gradle_content)

        deps = service._parse_gradle(str(gradle_file))
        project_deps = [d for d in deps if d.version == '']
        assert len(project_deps) >= 2
        names = {d.name for d in project_deps}
        assert "core-lib" in names
        assert "shared-utils" in names


# ── Terraform tests ──────────────────────────────────────────────────


class TestParseTerraform:
    def test_module_sources(self, service, tmp_path):
        tf_content = textwrap.dedent("""\
            module "vpc" {
              source = "../infrastructure"
            }

            module "ecs" {
              source = "git::https://github.com/org/ecs-module.git"
            }
        """)
        tf_file = tmp_path / "main.tf"
        tf_file.write_text(tf_content)

        deps = service._parse_terraform(str(tmp_path))
        assert len(deps) == 2
        assert deps[0].name == "../infrastructure"
        assert deps[0].dep_type == "terraform"
        assert deps[1].name == "git::https://github.com/org/ecs-module.git"

    def test_remote_state(self, service, tmp_path):
        tf_content = textwrap.dedent("""\
            data "terraform_remote_state" "network" {
              backend = "s3"
              config = {
                bucket = "my-bucket"
              }
            }
        """)
        tf_file = tmp_path / "data.tf"
        tf_file.write_text(tf_content)

        deps = service._parse_terraform(str(tmp_path))
        assert len(deps) == 1
        assert deps[0].name == "network"
        assert deps[0].dep_type == "terraform"

    def test_no_tf_files(self, service, tmp_path):
        deps = service._parse_terraform(str(tmp_path))
        assert deps == []


# ── Dockerfile tests ─────────────────────────────────────────────────


class TestParseDockerfile:
    def test_from_images(self, service, tmp_path):
        dockerfile_content = textwrap.dedent("""\
            FROM node:18-alpine AS builder
            WORKDIR /app
            COPY . .
            RUN npm run build

            FROM nginx:1.25
            COPY --from=builder /app/dist /usr/share/nginx/html
        """)
        dockerfile = tmp_path / "Dockerfile"
        dockerfile.write_text(dockerfile_content)

        deps = service._parse_dockerfile(str(dockerfile))
        # 2 FROM images + 1 COPY --from (builder is a stage alias, not numeric)
        from_deps = [d for d in deps if d.name != "builder"]
        assert len(from_deps) == 2
        assert from_deps[0].name == "node"
        assert from_deps[0].version == "18-alpine"
        assert from_deps[1].name == "nginx"
        assert from_deps[1].version == "1.25"

    def test_copy_from_external_image(self, service, tmp_path):
        dockerfile_content = textwrap.dedent("""\
            FROM ubuntu:22.04
            COPY --from=my-base-image /opt/app /opt/app
        """)
        dockerfile = tmp_path / "Dockerfile"
        dockerfile.write_text(dockerfile_content)

        deps = service._parse_dockerfile(str(dockerfile))
        names = {d.name for d in deps}
        assert "ubuntu" in names
        assert "my-base-image" in names

    def test_copy_from_numeric_stage_skipped(self, service, tmp_path):
        dockerfile_content = textwrap.dedent("""\
            FROM golang:1.21 AS build
            RUN go build -o app

            FROM alpine:3.18
            COPY --from=0 /app /app
        """)
        dockerfile = tmp_path / "Dockerfile"
        dockerfile.write_text(dockerfile_content)

        deps = service._parse_dockerfile(str(dockerfile))
        # Numeric stage "0" should be skipped in COPY --from
        copy_from_deps = [d for d in deps if d.source_file == str(dockerfile) and d.version == '']
        # "build" is a named stage from COPY --from, but "0" is numeric and skipped
        numeric_refs = [d for d in deps if d.name == "0"]
        assert len(numeric_refs) == 0

    def test_from_with_platform(self, service, tmp_path):
        dockerfile_content = "FROM --platform=linux/amd64 python:3.11-slim\n"
        dockerfile = tmp_path / "Dockerfile"
        dockerfile.write_text(dockerfile_content)

        deps = service._parse_dockerfile(str(dockerfile))
        assert len(deps) == 1
        assert deps[0].name == "python"
        assert deps[0].version == "3.11-slim"


# ── Docker Compose tests ─────────────────────────────────────────────


class TestParseDockerCompose:
    def test_depends_on_list(self, service, tmp_path):
        compose_content = textwrap.dedent("""\
            version: '3.8'
            services:
              web:
                image: my-web
                depends_on:
                  - db
                  - redis
              db:
                image: postgres:14
              redis:
                image: redis:7
        """)
        compose_file = tmp_path / "docker-compose.yml"
        compose_file.write_text(compose_content)

        deps = service._parse_docker_compose(str(compose_file))
        assert len(deps) == 2
        names = {d.name for d in deps}
        assert names == {"db", "redis"}
        assert all(d.dep_type == "docker-compose" for d in deps)

    def test_depends_on_dict(self, service, tmp_path):
        compose_content = textwrap.dedent("""\
            version: '3.8'
            services:
              api:
                image: my-api
                depends_on:
                  db:
                    condition: service_healthy
                  cache:
                    condition: service_started
        """)
        compose_file = tmp_path / "docker-compose.yml"
        compose_file.write_text(compose_content)

        deps = service._parse_docker_compose(str(compose_file))
        assert len(deps) == 2
        names = {d.name for d in deps}
        assert names == {"db", "cache"}

    def test_no_depends_on(self, service, tmp_path):
        compose_content = textwrap.dedent("""\
            version: '3.8'
            services:
              standalone:
                image: my-app
        """)
        compose_file = tmp_path / "docker-compose.yml"
        compose_file.write_text(compose_content)

        deps = service._parse_docker_compose(str(compose_file))
        assert deps == []


# ── .NET csproj tests ────────────────────────────────────────────────


class TestParseCsproj:
    def test_project_references(self, service, tmp_path):
        csproj_content = textwrap.dedent("""\
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <ProjectReference Include="..\\SharedLib\\SharedLib.csproj" />
                <ProjectReference Include="..\\DataAccess\\DataAccess.csproj" />
              </ItemGroup>
            </Project>
        """)
        csproj_file = tmp_path / "MyApp.csproj"
        csproj_file.write_text(csproj_content)

        deps = service._parse_csproj(str(csproj_file))
        proj_refs = [d for d in deps if d.version == '']
        assert len(proj_refs) == 2
        names = {d.name for d in proj_refs}
        assert "SharedLib" in names
        assert "DataAccess" in names

    def test_package_references(self, service, tmp_path):
        csproj_content = textwrap.dedent("""\
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
                <PackageReference Include="Serilog" Version="3.1.1" />
              </ItemGroup>
            </Project>
        """)
        csproj_file = tmp_path / "MyApp.csproj"
        csproj_file.write_text(csproj_content)

        deps = service._parse_csproj(str(csproj_file))
        assert len(deps) == 2
        assert deps[0].name == "Newtonsoft.Json"
        assert deps[0].version == "13.0.3"
        assert deps[0].dep_type == "dotnet"

    def test_version_as_child_element(self, service, tmp_path):
        csproj_content = textwrap.dedent("""\
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Microsoft.Extensions.Logging">
                  <Version>7.0.0</Version>
                </PackageReference>
              </ItemGroup>
            </Project>
        """)
        csproj_file = tmp_path / "MyApp.csproj"
        csproj_file.write_text(csproj_content)

        deps = service._parse_csproj(str(csproj_file))
        assert len(deps) == 1
        assert deps[0].version == "7.0.0"


# ── Python parser tests ──────────────────────────────────────────────


class TestParsePython:
    def test_requirements_txt(self, service, tmp_path):
        req_content = textwrap.dedent("""\
            # Core dependencies
            flask==2.3.0
            requests>=2.28.0
            boto3~=1.34.0
            numpy
        """)
        (tmp_path / "requirements.txt").write_text(req_content)

        deps = service._parse_python(str(tmp_path))
        assert len(deps) == 4
        names = {d.name for d in deps}
        assert names == {"flask", "requests", "boto3", "numpy"}
        flask_dep = next(d for d in deps if d.name == "flask")
        assert flask_dep.version == "2.3.0"
        assert flask_dep.dep_type == "python"

    def test_requirements_txt_with_extras(self, service, tmp_path):
        req_content = "uvicorn[standard]==0.30.6\n"
        (tmp_path / "requirements.txt").write_text(req_content)

        deps = service._parse_python(str(tmp_path))
        assert len(deps) == 1
        assert deps[0].name == "uvicorn"
        assert deps[0].version == "0.30.6"

    def test_pyproject_toml_pep621(self, service, tmp_path):
        pyproject_content = textwrap.dedent("""\
            [project]
            name = "my-package"
            dependencies = [
                "fastapi>=0.100.0",
                "pydantic>=2.0",
            ]
        """)
        (tmp_path / "pyproject.toml").write_text(pyproject_content)

        deps = service._parse_python(str(tmp_path))
        assert len(deps) == 2
        names = {d.name for d in deps}
        assert names == {"fastapi", "pydantic"}

    def test_pyproject_toml_poetry(self, service, tmp_path):
        pyproject_content = textwrap.dedent("""\
            [tool.poetry]
            name = "my-app"

            [tool.poetry.dependencies]
            python = "^3.11"
            django = "^4.2"
            celery = "^5.3"

            [tool.poetry.dev-dependencies]
            pytest = "^7.0"
        """)
        (tmp_path / "pyproject.toml").write_text(pyproject_content)

        deps = service._parse_python(str(tmp_path))
        # python should be excluded
        names = {d.name for d in deps}
        assert "python" not in names
        assert "django" in names
        assert "celery" in names
        assert "pytest" in names

    def test_both_files(self, service, tmp_path):
        (tmp_path / "requirements.txt").write_text("flask==2.3.0\n")
        pyproject = textwrap.dedent("""\
            [project]
            name = "my-app"
            dependencies = ["requests>=2.28"]
        """)
        (tmp_path / "pyproject.toml").write_text(pyproject)

        deps = service._parse_python(str(tmp_path))
        names = {d.name for d in deps}
        assert "flask" in names
        assert "requests" in names

    def test_skip_comments_and_flags(self, service, tmp_path):
        req_content = textwrap.dedent("""\
            # This is a comment
            -r base.txt
            -e git+https://github.com/org/repo.git
            flask==2.3.0
        """)
        (tmp_path / "requirements.txt").write_text(req_content)

        deps = service._parse_python(str(tmp_path))
        assert len(deps) == 1
        assert deps[0].name == "flask"


# ── _scan_repo tests ─────────────────────────────────────────────────


class TestScanRepo:
    def test_maven_repo(self, service, tmp_path):
        repo = tmp_path / "backend-api"
        repo.mkdir()
        pom = textwrap.dedent("""\
            <?xml version="1.0"?>
            <project xmlns="http://maven.apache.org/POM/4.0.0">
                <dependencies>
                    <dependency>
                        <groupId>com.example</groupId>
                        <artifactId>core-lib</artifactId>
                        <version>1.0</version>
                    </dependency>
                </dependencies>
            </project>
        """)
        (repo / "pom.xml").write_text(pom)

        metadata = service._scan_repo(str(repo))
        assert metadata.name == "backend-api"
        assert "maven" in metadata.build_systems
        assert "java" in metadata.languages
        assert len(metadata.dependencies) == 1

    def test_npm_repo(self, service, tmp_path):
        repo = tmp_path / "frontend"
        repo.mkdir()
        pkg = {"name": "frontend", "dependencies": {"react": "^18.0.0"}}
        (repo / "package.json").write_text(json.dumps(pkg))

        metadata = service._scan_repo(str(repo))
        assert "npm" in metadata.build_systems
        assert "javascript" in metadata.languages
        assert len(metadata.dependencies) == 1

    def test_multi_build_system_repo(self, service, tmp_path):
        repo = tmp_path / "full-stack"
        repo.mkdir()
        # Has both package.json and Dockerfile
        pkg = {"name": "app", "dependencies": {"express": "^4.18.0"}}
        (repo / "package.json").write_text(json.dumps(pkg))
        (repo / "Dockerfile").write_text("FROM node:18\n")

        metadata = service._scan_repo(str(repo))
        assert "npm" in metadata.build_systems
        assert "docker" in metadata.build_systems
        assert len(metadata.dependencies) == 2  # express + node base image

    def test_empty_repo(self, service, tmp_path):
        repo = tmp_path / "empty-repo"
        repo.mkdir()

        metadata = service._scan_repo(str(repo))
        assert metadata.name == "empty-repo"
        assert metadata.languages == []
        assert metadata.build_systems == []
        assert metadata.dependencies == []

    def test_terraform_repo(self, service, tmp_path):
        repo = tmp_path / "infra"
        repo.mkdir()
        tf = textwrap.dedent("""\
            module "vpc" {
              source = "../networking"
            }
        """)
        (repo / "main.tf").write_text(tf)

        metadata = service._scan_repo(str(repo))
        assert "terraform" in metadata.build_systems
        assert "hcl" in metadata.languages
        assert len(metadata.dependencies) == 1

    def test_dotnet_repo(self, service, tmp_path):
        repo = tmp_path / "dotnet-api"
        repo.mkdir()
        csproj = textwrap.dedent("""\
            <Project Sdk="Microsoft.NET.Sdk">
              <ItemGroup>
                <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
              </ItemGroup>
            </Project>
        """)
        (repo / "MyApp.csproj").write_text(csproj)

        metadata = service._scan_repo(str(repo))
        assert "dotnet" in metadata.build_systems
        assert "csharp" in metadata.languages
        assert len(metadata.dependencies) == 1

    def test_python_repo(self, service, tmp_path):
        repo = tmp_path / "ml-service"
        repo.mkdir()
        (repo / "requirements.txt").write_text("numpy==1.24.0\npandas==2.0.0\n")

        metadata = service._scan_repo(str(repo))
        assert "python" in metadata.build_systems
        assert "python" in metadata.languages
        assert len(metadata.dependencies) == 2


# ── _build_graph tests ───────────────────────────────────────────────


class TestBuildGraph:
    def test_no_inter_repo_dependencies(self, service):
        """Repos with no matching dependencies produce an empty graph."""
        repos = {
            "repo-a": RepoMetadata(
                name="repo-a",
                languages=["java"],
                build_systems=["maven"],
                dependencies=[
                    Dependency(name="org.springframework:spring-core", version="5.0", dep_type="maven", source_file="pom.xml"),
                ],
            ),
            "repo-b": RepoMetadata(
                name="repo-b",
                languages=["python"],
                build_systems=["python"],
                dependencies=[
                    Dependency(name="flask", version="2.3.0", dep_type="python", source_file="requirements.txt"),
                ],
            ),
        }
        graph = service._build_graph(repos)
        assert graph == {"repo-a": [], "repo-b": []}

    def test_maven_artifact_id_match(self, service):
        """Maven dependency matching by artifactId against repo name."""
        repos = {
            "backend-api": RepoMetadata(
                name="backend-api",
                languages=["java"],
                build_systems=["maven"],
                dependencies=[
                    Dependency(name="com.example:shared-lib", version="1.0", dep_type="maven", source_file="pom.xml"),
                ],
            ),
            "shared-lib": RepoMetadata(
                name="shared-lib",
                languages=["java"],
                build_systems=["maven"],
                dependencies=[],
            ),
        }
        graph = service._build_graph(repos)
        assert "shared-lib" in graph["backend-api"]
        assert graph["shared-lib"] == []

    def test_npm_package_name_match(self, service):
        """npm dependency matching by package name against repo name."""
        repos = {
            "frontend": RepoMetadata(
                name="frontend",
                languages=["javascript"],
                build_systems=["npm"],
                dependencies=[
                    Dependency(name="shared-utils", version="^1.0.0", dep_type="npm", source_file="package.json"),
                ],
            ),
            "shared-utils": RepoMetadata(
                name="shared-utils",
                languages=["javascript"],
                build_systems=["npm"],
                dependencies=[],
            ),
        }
        graph = service._build_graph(repos)
        assert "shared-utils" in graph["frontend"]

    def test_python_package_name_match(self, service):
        """Python dependency matching with hyphen/underscore normalization."""
        repos = {
            "ml-service": RepoMetadata(
                name="ml-service",
                languages=["python"],
                build_systems=["python"],
                dependencies=[
                    Dependency(name="core-utils", version="1.0", dep_type="python", source_file="requirements.txt"),
                ],
            ),
            "core_utils": RepoMetadata(
                name="core_utils",
                languages=["python"],
                build_systems=["python"],
                dependencies=[],
            ),
        }
        graph = service._build_graph(repos)
        assert "core_utils" in graph["ml-service"]

    def test_terraform_module_source_match(self, service):
        """Terraform module source path matching against repo name."""
        repos = {
            "app-infra": RepoMetadata(
                name="app-infra",
                languages=["hcl"],
                build_systems=["terraform"],
                dependencies=[
                    Dependency(name="../networking", version="", dep_type="terraform", source_file="main.tf"),
                ],
            ),
            "networking": RepoMetadata(
                name="networking",
                languages=["hcl"],
                build_systems=["terraform"],
                dependencies=[],
            ),
        }
        graph = service._build_graph(repos)
        assert "networking" in graph["app-infra"]

    def test_single_repo(self, service):
        """Single repo produces a graph with one node and no edges."""
        repos = {
            "solo": RepoMetadata(
                name="solo",
                languages=["python"],
                build_systems=["python"],
                dependencies=[
                    Dependency(name="flask", version="2.3", dep_type="python", source_file="requirements.txt"),
                ],
            ),
        }
        graph = service._build_graph(repos)
        assert graph == {"solo": []}

    def test_no_self_dependency(self, service):
        """A repo should not depend on itself even if its name matches a dep."""
        repos = {
            "my-lib": RepoMetadata(
                name="my-lib",
                languages=["python"],
                build_systems=["python"],
                dependencies=[
                    Dependency(name="my-lib", version="1.0", dep_type="python", source_file="requirements.txt"),
                ],
            ),
        }
        graph = service._build_graph(repos)
        assert graph == {"my-lib": []}

    def test_no_duplicate_edges(self, service):
        """Multiple deps matching the same repo should produce only one edge."""
        repos = {
            "consumer": RepoMetadata(
                name="consumer",
                languages=["java"],
                build_systems=["maven"],
                dependencies=[
                    Dependency(name="com.example:provider", version="1.0", dep_type="maven", source_file="pom.xml"),
                    Dependency(name="provider", version="1.0", dep_type="npm", source_file="package.json"),
                ],
            ),
            "provider": RepoMetadata(
                name="provider",
                languages=["java"],
                build_systems=["maven"],
                dependencies=[],
            ),
        }
        graph = service._build_graph(repos)
        assert graph["consumer"].count("provider") == 1


# ── _topological_sort tests ──────────────────────────────────────────


class TestTopologicalSort:
    def test_linear_chain(self, service):
        """A → B → C should produce order [C, B, A]."""
        graph = {"A": ["B"], "B": ["C"], "C": []}
        order = service._topological_sort(graph)
        assert order.index("C") < order.index("B") < order.index("A")

    def test_no_edges(self, service):
        """Disconnected nodes should all appear in the result."""
        graph = {"X": [], "Y": [], "Z": []}
        order = service._topological_sort(graph)
        assert set(order) == {"X", "Y", "Z"}

    def test_diamond_dependency(self, service):
        """Diamond: A→B, A→C, B→D, C→D. D must come first, A last."""
        graph = {"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}
        order = service._topological_sort(graph)
        assert order.index("D") < order.index("B")
        assert order.index("D") < order.index("C")
        assert order.index("B") < order.index("A")
        assert order.index("C") < order.index("A")

    def test_single_node(self, service):
        graph = {"only": []}
        order = service._topological_sort(graph)
        assert order == ["only"]

    def test_cycle_detection_and_break(self, service):
        """A cycle A→B→A should be broken, both nodes appear in output."""
        graph = {"A": ["B"], "B": ["A"]}
        order = service._topological_sort(graph)
        assert set(order) == {"A", "B"}
        assert len(service._cycles_detected) > 0

    def test_three_node_cycle(self, service):
        """A→B→C→A cycle should be broken, all nodes in output."""
        graph = {"A": ["B"], "B": ["C"], "C": ["A"]}
        order = service._topological_sort(graph)
        assert set(order) == {"A", "B", "C"}
        assert len(service._cycles_detected) > 0

    def test_mixed_cycle_and_acyclic(self, service):
        """Graph with both cyclic and acyclic parts."""
        # D depends on nothing, A→B→C→A is a cycle, A also depends on D
        graph = {"A": ["B", "D"], "B": ["C"], "C": ["A"], "D": []}
        order = service._topological_sort(graph)
        assert set(order) == {"A", "B", "C", "D"}
        assert order.index("D") < order.index("A")


# ── _generate_mermaid tests ──────────────────────────────────────────


class TestGenerateMermaid:
    def test_basic_mermaid(self, service):
        graph = {"frontend": ["backend"], "backend": []}
        metadata = {
            "frontend": RepoMetadata(name="frontend", languages=["javascript"], build_systems=["npm"]),
            "backend": RepoMetadata(name="backend", languages=["java"], build_systems=["maven"]),
        }
        mermaid = service._generate_mermaid(graph, metadata)
        assert mermaid.startswith("graph TD")
        assert "frontend" in mermaid
        assert "backend" in mermaid
        assert "frontend --> backend" in mermaid

    def test_node_labels_include_metadata(self, service):
        graph = {"api": []}
        metadata = {
            "api": RepoMetadata(name="api", languages=["python"], build_systems=["python"]),
        }
        mermaid = service._generate_mermaid(graph, metadata)
        assert "Python" in mermaid

    def test_empty_graph(self, service):
        graph: dict[str, list[str]] = {}
        metadata: dict[str, RepoMetadata] = {}
        mermaid = service._generate_mermaid(graph, metadata)
        assert mermaid == "graph TD"

    def test_disconnected_nodes(self, service):
        graph = {"a": [], "b": [], "c": []}
        metadata = {
            "a": RepoMetadata(name="a"),
            "b": RepoMetadata(name="b"),
            "c": RepoMetadata(name="c"),
        }
        mermaid = service._generate_mermaid(graph, metadata)
        assert "a" in mermaid
        assert "b" in mermaid
        assert "c" in mermaid
        assert "-->" not in mermaid


# ── discover() integration tests ─────────────────────────────────────


class TestDiscover:
    def test_two_repo_maven_dependency(self, service, tmp_path):
        """Integration: two Maven repos where api depends on shared-lib."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        # shared-lib repo
        shared = workspace / "shared-lib"
        shared.mkdir()
        (shared / "pom.xml").write_text(textwrap.dedent("""\
            <?xml version="1.0"?>
            <project xmlns="http://maven.apache.org/POM/4.0.0">
                <groupId>com.example</groupId>
                <artifactId>shared-lib</artifactId>
                <version>1.0.0</version>
                <dependencies>
                    <dependency>
                        <groupId>org.slf4j</groupId>
                        <artifactId>slf4j-api</artifactId>
                        <version>2.0.0</version>
                    </dependency>
                </dependencies>
            </project>
        """))

        # backend-api repo that depends on shared-lib
        api = workspace / "backend-api"
        api.mkdir()
        (api / "pom.xml").write_text(textwrap.dedent("""\
            <?xml version="1.0"?>
            <project xmlns="http://maven.apache.org/POM/4.0.0">
                <groupId>com.example</groupId>
                <artifactId>backend-api</artifactId>
                <version>1.0.0</version>
                <dependencies>
                    <dependency>
                        <groupId>com.example</groupId>
                        <artifactId>shared-lib</artifactId>
                        <version>1.0.0</version>
                    </dependency>
                </dependencies>
            </project>
        """))

        result = service.discover(str(workspace), ["shared-lib", "backend-api"])

        assert isinstance(result, DiscoveryResult)
        assert "shared-lib" in result.dependency_graph["backend-api"]
        assert result.dependency_graph["shared-lib"] == []
        # shared-lib should come before backend-api in execution order
        assert result.execution_order.index("shared-lib") < result.execution_order.index("backend-api")
        assert result.mermaid_diagram.startswith("graph TD")
        assert "backend-api --> shared-lib" in result.mermaid_diagram
        assert result.cycles_detected == []

    def test_three_repo_chain(self, service, tmp_path):
        """Integration: infra → database → api chain using mixed build systems."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        # infra repo (terraform)
        infra = workspace / "infra"
        infra.mkdir()
        (infra / "main.tf").write_text(textwrap.dedent("""\
            resource "aws_vpc" "main" {
              cidr_block = "10.0.0.0/16"
            }
        """))

        # database repo (python, depends on infra via terraform module)
        db = workspace / "database"
        db.mkdir()
        (db / "requirements.txt").write_text("alembic==1.12.0\nsqlalchemy==2.0.0\n")
        (db / "main.tf").write_text(textwrap.dedent("""\
            module "vpc" {
              source = "../infra"
            }
        """))

        # api repo (npm, depends on database by name)
        api = workspace / "api"
        api.mkdir()
        pkg = {"name": "api", "dependencies": {"database": "^1.0.0", "express": "^4.18.0"}}
        (api / "package.json").write_text(json.dumps(pkg))

        result = service.discover(str(workspace), ["infra", "database", "api"])

        assert "infra" in result.dependency_graph["database"]
        assert "database" in result.dependency_graph["api"]
        # Execution order: infra first, then database, then api
        assert result.execution_order.index("infra") < result.execution_order.index("database")
        assert result.execution_order.index("database") < result.execution_order.index("api")
        assert result.cycles_detected == []

    def test_disconnected_repos(self, service, tmp_path):
        """Integration: repos with no inter-dependencies."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        for name in ("alpha", "beta", "gamma"):
            repo = workspace / name
            repo.mkdir()
            (repo / "requirements.txt").write_text("flask==2.3.0\n")

        result = service.discover(str(workspace), ["alpha", "beta", "gamma"])

        # No edges
        for deps in result.dependency_graph.values():
            assert deps == []
        # All repos in execution order
        assert set(result.execution_order) == {"alpha", "beta", "gamma"}
        assert result.cycles_detected == []

    def test_cyclic_dependency(self, service, tmp_path):
        """Integration: two repos that depend on each other (cycle)."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()

        # repo-a depends on repo-b
        a = workspace / "repo-a"
        a.mkdir()
        pkg_a = {"name": "repo-a", "dependencies": {"repo-b": "^1.0.0"}}
        (a / "package.json").write_text(json.dumps(pkg_a))

        # repo-b depends on repo-a
        b = workspace / "repo-b"
        b.mkdir()
        pkg_b = {"name": "repo-b", "dependencies": {"repo-a": "^1.0.0"}}
        (b / "package.json").write_text(json.dumps(pkg_b))

        result = service.discover(str(workspace), ["repo-a", "repo-b"])

        # Both repos should appear in execution order despite cycle
        assert set(result.execution_order) == {"repo-a", "repo-b"}
        assert len(result.cycles_detected) > 0
        assert result.mermaid_diagram.startswith("graph TD")

    def test_single_repo_no_deps(self, service, tmp_path):
        """Integration: single repo with no build files."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / "lonely").mkdir()

        result = service.discover(str(workspace), ["lonely"])

        assert result.dependency_graph == {"lonely": []}
        assert result.execution_order == ["lonely"]
        assert result.cycles_detected == []

    def test_missing_repo_directory(self, service, tmp_path):
        """Integration: repo name that doesn't exist on disk."""
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        (workspace / "exists").mkdir()

        result = service.discover(str(workspace), ["exists", "ghost"])

        assert "exists" in result.execution_order
        assert "ghost" in result.execution_order
        assert result.repo_metadata["ghost"].languages == []
