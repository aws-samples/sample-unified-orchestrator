"""
Dependency Discovery Service

Scans repos for build/config files, parses each file type to extract
dependency identifiers, and cross-references them against repo names
in the workspace to build a directed dependency graph.
"""

import json
import logging
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import defusedxml.ElementTree as ET  # secure XML parsing — defusedxml is a required dependency

try:
    import toml as toml_lib
except ImportError:
    toml_lib = None

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


@dataclass
class Dependency:
    """A single dependency extracted from a build/config file."""
    name: str           # artifact/package name
    version: str        # version string (empty string if unknown)
    dep_type: str       # 'maven', 'npm', 'terraform', 'docker', etc.
    source_file: str    # file where found


@dataclass
class RepoMetadata:
    """Metadata discovered for a single repository."""
    name: str
    languages: list[str] = field(default_factory=list)
    build_systems: list[str] = field(default_factory=list)
    dependencies: list[Dependency] = field(default_factory=list)


@dataclass
class DiscoveryResult:
    """Result of the full dependency discovery process."""
    dependency_graph: dict[str, list[str]]          # adjacency map
    execution_order: list[str]                      # topologically sorted
    mermaid_diagram: str
    repo_metadata: dict[str, RepoMetadata]
    cycles_detected: list[tuple[str, str]]          # broken cycles


class DependencyDiscoveryService:
    """
    Scans repositories for build/config files, extracts dependency
    information, builds a directed graph, and produces a topological
    execution order.
    """


    # ── Maven pom.xml ────────────────────────────────────────────────

    def _parse_pom_xml(self, path: str) -> list[Dependency]:
        """Extract groupId, artifactId, and dependencies from a Maven pom.xml.

        Uses defusedxml for safe XML parsing.
        """
        deps: list[Dependency] = []
        try:
            tree = ET.parse(path)
            root = tree.getroot()

            # Detect namespace (Maven POM uses a default namespace)
            ns_match = re.match(r'\{(.*)\}', root.tag)
            ns = f'{{{ns_match.group(1)}}}' if ns_match else ''

            for dep_elem in root.findall(f'.//{ns}dependencies/{ns}dependency'):
                group_id = self._xml_text(dep_elem, f'{ns}groupId')
                artifact_id = self._xml_text(dep_elem, f'{ns}artifactId')
                version = self._xml_text(dep_elem, f'{ns}version') or ''

                if artifact_id:
                    name = f"{group_id}:{artifact_id}" if group_id else artifact_id
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='maven',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse pom.xml {path}: {e}")

        return deps

    # ── npm package.json ─────────────────────────────────────────────

    def _parse_package_json(self, path: str) -> list[Dependency]:
        """Extract package name, dependencies, and devDependencies from package.json."""
        deps: list[Dependency] = []
        try:
            data = json.loads(Path(path).read_text(encoding='utf-8'))

            for section in ('dependencies', 'devDependencies'):
                for name, version in data.get(section, {}).items():
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='npm',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse package.json {path}: {e}")

        return deps

    # ── Gradle build.gradle / build.gradle.kts ───────────────────────

    def _parse_gradle(self, path: str) -> list[Dependency]:
        """Extract dependencies from build.gradle or build.gradle.kts.

        Parses common dependency declaration patterns:
          implementation 'group:artifact:version'
          implementation("group:artifact:version")
          api 'group:artifact:version'
          compile 'group:artifact:version'
          project(':sub-module')
        """
        deps: list[Dependency] = []
        try:
            content = Path(path).read_text(encoding='utf-8')

            # Match: configuration 'group:artifact:version' or "group:artifact:version"
            gav_pattern = re.compile(
                r'(?:implementation|api|compile|runtimeOnly|testImplementation|compileOnly)'
                r"""\s*[\(]?\s*['"]([^'"]+:[^'"]+)['"]""",
            )
            for match in gav_pattern.finditer(content):
                parts = match.group(1).split(':')
                if len(parts) >= 2:
                    name = f"{parts[0]}:{parts[1]}"
                    version = parts[2] if len(parts) >= 3 else ''
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='gradle',
                        source_file=path,
                    ))

            # Match: project(':sub-module') or project(":sub-module")
            project_pattern = re.compile(r"""project\s*\(\s*['":]+([^'")\s]+)['"]?\s*\)""")
            for match in project_pattern.finditer(content):
                module_name = match.group(1).lstrip(':')
                deps.append(Dependency(
                    name=module_name,
                    version='',
                    dep_type='gradle',
                    source_file=path,
                ))

        except Exception as e:
            logger.warning(f"Failed to parse Gradle file {path}: {e}")

        return deps

    # ── Terraform *.tf ───────────────────────────────────────────────

    def _parse_terraform(self, repo_dir: str) -> list[Dependency]:
        """Scan *.tf files for module sources and remote state references."""
        deps: list[Dependency] = []
        try:
            tf_files = list(Path(repo_dir).rglob('*.tf'))
            for tf_file in tf_files:
                content = tf_file.read_text(encoding='utf-8')

                # Module source references
                # module "name" { source = "../other-repo" }
                # module "name" { source = "git::https://..." }
                module_pattern = re.compile(
                    r'module\s+"[^"]*"\s*\{[^}]*?source\s*=\s*"([^"]+)"',
                    re.DOTALL,
                )
                for match in module_pattern.finditer(content):
                    source = match.group(1)
                    deps.append(Dependency(
                        name=source,
                        version='',
                        dep_type='terraform',
                        source_file=str(tf_file),
                    ))

                # Remote state data sources
                # data "terraform_remote_state" "name" { ... }
                remote_state_pattern = re.compile(
                    r'data\s+"terraform_remote_state"\s+"([^"]+)"',
                )
                for match in remote_state_pattern.finditer(content):
                    deps.append(Dependency(
                        name=match.group(1),
                        version='',
                        dep_type='terraform',
                        source_file=str(tf_file),
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse Terraform files in {repo_dir}: {e}")

        return deps

    # ── Dockerfile ───────────────────────────────────────────────────

    def _parse_dockerfile(self, path: str) -> list[Dependency]:
        """Extract FROM base images and COPY --from references from a Dockerfile."""
        deps: list[Dependency] = []
        try:
            content = Path(path).read_text(encoding='utf-8')

            # FROM image:tag [AS alias]
            from_pattern = re.compile(
                r'^FROM\s+(?:--platform=\S+\s+)?(\S+?)(?:\s+AS\s+\S+)?$',
                re.MULTILINE | re.IGNORECASE,
            )
            for match in from_pattern.finditer(content):
                image = match.group(1)
                parts = image.split(':')
                name = parts[0]
                version = parts[1] if len(parts) > 1 else 'latest'
                deps.append(Dependency(
                    name=name,
                    version=version,
                    dep_type='docker',
                    source_file=path,
                ))

            # COPY --from=stage_or_image
            copy_from_pattern = re.compile(
                r'COPY\s+--from=(\S+)',
                re.IGNORECASE,
            )
            for match in copy_from_pattern.finditer(content):
                ref = match.group(1)
                # Skip numeric stage references (multi-stage build indices)
                if not ref.isdigit():
                    deps.append(Dependency(
                        name=ref,
                        version='',
                        dep_type='docker',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse Dockerfile {path}: {e}")

        return deps

    # ── Docker Compose ───────────────────────────────────────────────

    def _parse_docker_compose(self, path: str) -> list[Dependency]:
        """Extract service depends_on declarations from docker-compose.yml."""
        deps: list[Dependency] = []
        if yaml is None:
            logger.warning("PyYAML not available, skipping docker-compose parsing")
            return deps
        try:
            data = yaml.safe_load(Path(path).read_text(encoding='utf-8'))
            services = data.get('services', {}) or {}

            for service_name, service_config in services.items():
                if not isinstance(service_config, dict):
                    continue
                depends_on = service_config.get('depends_on', [])

                # depends_on can be a list or a dict
                if isinstance(depends_on, list):
                    dep_names = depends_on
                elif isinstance(depends_on, dict):
                    dep_names = list(depends_on.keys())
                else:
                    continue

                for dep_name in dep_names:
                    deps.append(Dependency(
                        name=dep_name,
                        version='',
                        dep_type='docker-compose',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse docker-compose {path}: {e}")

        return deps

    # ── .NET *.csproj ────────────────────────────────────────────────

    def _parse_csproj(self, path: str) -> list[Dependency]:
        """Extract ProjectReference and PackageReference elements from .csproj."""
        deps: list[Dependency] = []
        try:
            tree = ET.parse(path)
            root = tree.getroot()

            ns_match = re.match(r'\{(.*)\}', root.tag)
            ns = f'{{{ns_match.group(1)}}}' if ns_match else ''

            # ProjectReference — inter-project dependencies
            for ref in root.findall(f'.//{ns}ProjectReference'):
                include = ref.get('Include', '')
                if include:
                    # Normalise Windows backslashes before extracting stem
                    proj_name = Path(include.replace('\\', '/')).stem
                    deps.append(Dependency(
                        name=proj_name,
                        version='',
                        dep_type='dotnet',
                        source_file=path,
                    ))

            # PackageReference — NuGet packages
            for ref in root.findall(f'.//{ns}PackageReference'):
                name = ref.get('Include', '')
                version = ref.get('Version', '')
                if not version:
                    version_elem = ref.find(f'{ns}Version')
                    version = version_elem.text.strip() if version_elem is not None and version_elem.text else ''
                if name:
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='dotnet',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse .csproj {path}: {e}")

        return deps

    # ── Python requirements.txt / pyproject.toml ─────────────────────

    def _parse_python(self, repo_dir: str) -> list[Dependency]:
        """Extract package names from requirements.txt and pyproject.toml."""
        deps: list[Dependency] = []
        repo_path = Path(repo_dir)

        # requirements.txt
        req_file = repo_path / 'requirements.txt'
        if req_file.exists():
            deps.extend(self._parse_requirements_txt(str(req_file)))

        # pyproject.toml
        pyproject_file = repo_path / 'pyproject.toml'
        if pyproject_file.exists():
            deps.extend(self._parse_pyproject_toml(str(pyproject_file)))

        return deps

    def _parse_requirements_txt(self, path: str) -> list[Dependency]:
        """Parse a requirements.txt file for package names and versions."""
        deps: list[Dependency] = []
        try:
            for line in Path(path).read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or line.startswith('-'):
                    continue
                # Remove inline comments
                if '#' in line:
                    line = line.split('#')[0].strip()
                # Split on version operators
                match = re.match(r'^([a-zA-Z0-9_\-\.]+)(?:\[.*\])?\s*(.*)', line)
                if match:
                    name = match.group(1)
                    version_spec = match.group(2).strip()
                    # Extract version number from spec like ==1.0, >=2.0
                    version = ''
                    if version_spec:
                        ver_match = re.search(r'[\d][^\s,]*', version_spec)
                        version = ver_match.group(0) if ver_match else version_spec
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='python',
                        source_file=path,
                    ))
        except Exception as e:
            logger.warning(f"Failed to parse requirements.txt {path}: {e}")
        return deps

    def _parse_pyproject_toml(self, path: str) -> list[Dependency]:
        """Parse a pyproject.toml file for dependency declarations."""
        deps: list[Dependency] = []
        if toml_lib is None:
            logger.warning("toml library not available, skipping pyproject.toml parsing")
            return deps
        try:
            data = toml_lib.loads(Path(path).read_text(encoding='utf-8'))

            # PEP 621 dependencies
            for dep_str in data.get('project', {}).get('dependencies', []):
                parsed = self._parse_pep508(dep_str)
                if parsed:
                    deps.append(Dependency(
                        name=parsed[0],
                        version=parsed[1],
                        dep_type='python',
                        source_file=path,
                    ))

            # Poetry dependencies
            for section in ('dependencies', 'dev-dependencies'):
                poetry_deps = data.get('tool', {}).get('poetry', {}).get(section, {})
                for name, ver in poetry_deps.items():
                    if name.lower() == 'python':
                        continue
                    version = ver if isinstance(ver, str) else ''
                    deps.append(Dependency(
                        name=name,
                        version=version,
                        dep_type='python',
                        source_file=path,
                    ))

        except Exception as e:
            logger.warning(f"Failed to parse pyproject.toml {path}: {e}")
        return deps

    # ── Repo scanner ─────────────────────────────────────────────────

    def _scan_repo(self, repo_dir: str) -> RepoMetadata:
        """Detect which build files exist in a repo and call appropriate parsers."""
        repo_path = Path(repo_dir)
        repo_name = repo_path.name
        metadata = RepoMetadata(name=repo_name)

        # Maven
        pom = repo_path / 'pom.xml'
        if pom.exists():
            metadata.build_systems.append('maven')
            metadata.languages.append('java')
            metadata.dependencies.extend(self._parse_pom_xml(str(pom)))

        # Gradle
        for gradle_file in ('build.gradle', 'build.gradle.kts'):
            gf = repo_path / gradle_file
            if gf.exists():
                if 'gradle' not in metadata.build_systems:
                    metadata.build_systems.append('gradle')
                if 'java' not in metadata.languages:
                    metadata.languages.append('java')
                metadata.dependencies.extend(self._parse_gradle(str(gf)))

        # npm / Node.js
        pkg_json = repo_path / 'package.json'
        if pkg_json.exists():
            metadata.build_systems.append('npm')
            metadata.languages.append('javascript')
            metadata.dependencies.extend(self._parse_package_json(str(pkg_json)))

        # Terraform
        tf_files = list(repo_path.glob('*.tf'))
        if tf_files:
            metadata.build_systems.append('terraform')
            metadata.languages.append('hcl')
            metadata.dependencies.extend(self._parse_terraform(str(repo_path)))

        # Dockerfile
        dockerfile = repo_path / 'Dockerfile'
        if dockerfile.exists():
            metadata.build_systems.append('docker')
            metadata.dependencies.extend(self._parse_dockerfile(str(dockerfile)))

        # Docker Compose
        for compose_name in ('docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'):
            compose_file = repo_path / compose_name
            if compose_file.exists():
                if 'docker-compose' not in metadata.build_systems:
                    metadata.build_systems.append('docker-compose')
                metadata.dependencies.extend(self._parse_docker_compose(str(compose_file)))

        # .NET csproj
        csproj_files = list(repo_path.rglob('*.csproj'))
        for csproj in csproj_files:
            if 'dotnet' not in metadata.build_systems:
                metadata.build_systems.append('dotnet')
            if 'csharp' not in metadata.languages:
                metadata.languages.append('csharp')
            metadata.dependencies.extend(self._parse_csproj(str(csproj)))

        # Python
        has_python = (repo_path / 'requirements.txt').exists() or (repo_path / 'pyproject.toml').exists()
        if has_python:
            if 'python' not in metadata.build_systems:
                metadata.build_systems.append('python')
            if 'python' not in metadata.languages:
                metadata.languages.append('python')
            metadata.dependencies.extend(self._parse_python(str(repo_path)))

        return metadata

    # ── Graph building ───────────────────────────────────────────────

    def _build_graph(self, repos: dict[str, RepoMetadata]) -> dict[str, list[str]]:
        """Cross-reference deps against repo names, return adjacency map.

        For each repo, check its dependencies against every OTHER repo by:
        - Repo directory name (exact match)
        - Maven artifactId (last segment of 'group:artifact')
        - npm / Python / Gradle package name
        An edge from A → B means A depends on B.
        """
        graph: dict[str, list[str]] = {name: [] for name in repos}

        # Build a lookup: possible identifier → repo name
        id_to_repo: dict[str, str] = {}
        for repo_name, meta in repos.items():
            # Match by repo directory name
            id_to_repo[repo_name] = repo_name
            id_to_repo[repo_name.lower()] = repo_name

            # Match by artifact/package identifiers from the repo's own build files
            for dep in meta.dependencies:
                # We only want identifiers that THIS repo publishes, not consumes.
                # However, we don't have explicit "publishes" info, so we use
                # the repo name and any package.json name / pom artifactId from
                # the repo's own metadata.
                pass

        # Also extract "self-identifiers" from build files
        for repo_name, meta in repos.items():
            repo_dir_lower = repo_name.lower()
            id_to_repo[repo_dir_lower] = repo_name

            # For Maven repos, extract the project's own artifactId from pom.xml
            # (already parsed as dependencies of others, but the repo's own
            # artifactId is the name it publishes)
            # We approximate: if a pom.xml exists, the repo name IS the artifact
            if 'maven' in meta.build_systems:
                id_to_repo[repo_name] = repo_name

            # For npm repos, extract the package name from package.json
            if 'npm' in meta.build_systems:
                self._register_npm_name(repo_name, meta, id_to_repo)

        for repo_name, meta in repos.items():
            for dep in meta.dependencies:
                matched_repo = self._match_dependency(dep, repo_name, repos, id_to_repo)
                if matched_repo and matched_repo not in graph[repo_name]:
                    graph[repo_name].append(matched_repo)

        return graph

    def _register_npm_name(
        self,
        repo_name: str,
        meta: RepoMetadata,
        id_to_repo: dict[str, str],
    ) -> None:
        """Register npm package name from a repo's package.json as an identifier."""
        for dep in meta.dependencies:
            if dep.dep_type == 'npm' and dep.source_file.endswith('package.json'):
                # The package.json name is in the file, not in deps.
                # We'll read it from the source file if accessible.
                break
        # Fallback: register repo name variants
        id_to_repo[repo_name.lower()] = repo_name

    def _match_dependency(
        self,
        dep: Dependency,
        source_repo: str,
        repos: dict[str, RepoMetadata],
        id_to_repo: dict[str, str],
    ) -> Optional[str]:
        """Try to match a dependency to another repo in the workspace."""
        dep_name_lower = dep.name.lower()

        for target_name in repos:
            if target_name == source_repo:
                continue

            target_lower = target_name.lower()

            # Exact repo name match
            if dep_name_lower == target_lower:
                return target_name

            # Maven: match artifactId (last part of 'group:artifact')
            if dep.dep_type == 'maven' and ':' in dep.name:
                artifact_id = dep.name.split(':')[-1].lower()
                if artifact_id == target_lower:
                    return target_name

            # Gradle: match artifact or project name
            if dep.dep_type == 'gradle':
                if ':' in dep.name:
                    artifact_id = dep.name.split(':')[-1].lower()
                    if artifact_id == target_lower:
                        return target_name
                elif dep_name_lower == target_lower:
                    return target_name

            # npm: match package name
            if dep.dep_type == 'npm' and dep_name_lower == target_lower:
                return target_name

            # Python: match package name (normalize hyphens/underscores)
            if dep.dep_type == 'python':
                normalized_dep = dep_name_lower.replace('-', '_').replace('.', '_')
                normalized_target = target_lower.replace('-', '_').replace('.', '_')
                if normalized_dep == normalized_target:
                    return target_name

            # .NET: match project reference name
            if dep.dep_type == 'dotnet' and dep_name_lower == target_lower:
                return target_name

            # Terraform: match module source path containing repo name
            if dep.dep_type == 'terraform':
                source_path = dep.name.rstrip('/')
                source_basename = source_path.split('/')[-1].lower()
                if source_basename == target_lower:
                    return target_name

            # Docker / docker-compose: match service/image name
            if dep.dep_type in ('docker', 'docker-compose'):
                if dep_name_lower == target_lower:
                    return target_name

        return None

    # ── Topological sort ─────────────────────────────────────────────

    def _topological_sort(self, graph: dict[str, list[str]]) -> list[str]:
        """Kahn's algorithm with cycle detection.

        The graph uses the convention: edge A → B means "A depends on B".
        Therefore B must come before A in execution order (dependencies first).

        We reverse the edges for Kahn's: build a reverse adjacency list where
        B → A, then process nodes with in_degree 0 (no dependencies) first.
        """
        cycles: list[tuple[str, str]] = []
        all_nodes = set(graph.keys())

        # Build reverse adjacency: for edge A→B (A depends on B),
        # reverse_adj[B] = [A] means "after B is done, A can proceed"
        reverse_adj: dict[str, list[str]] = {n: [] for n in all_nodes}
        # out_degree here tracks how many dependencies each node has
        dep_count: dict[str, int] = {n: 0 for n in all_nodes}

        for node, dependencies in graph.items():
            for dep in dependencies:
                if dep in all_nodes:
                    reverse_adj[dep].append(node)
                    dep_count[node] += 1

        queue: deque[str] = deque()
        for node in all_nodes:
            if dep_count[node] == 0:
                queue.append(node)

        order: list[str] = []

        while queue:
            node = queue.popleft()
            order.append(node)
            for dependent in reverse_adj[node]:
                dep_count[dependent] -= 1
                if dep_count[dependent] == 0:
                    queue.append(dependent)

        # If not all nodes processed, there's a cycle among remaining nodes
        while len(order) < len(all_nodes):
            remaining = [n for n in all_nodes if n not in set(order)]
            if not remaining:
                break

            # Break the weakest edge: pick a remaining node and remove one
            # of its dependency edges
            target = min(remaining, key=lambda n: dep_count.get(n, 0))

            # Find a dependency of target that is also in remaining, and break it
            for dep in list(graph.get(target, [])):
                if dep in set(remaining):
                    # Remove this edge from our working structures
                    reverse_adj[dep].remove(target)
                    dep_count[target] -= 1
                    cycles.append((target, dep))
                    logger.warning(
                        f"Cycle detected: broke edge {target} → {dep}"
                    )
                    break

            if dep_count.get(target, 0) == 0:
                queue.append(target)

            # Continue Kahn's
            while queue:
                node = queue.popleft()
                order.append(node)
                for dependent in reverse_adj.get(node, []):
                    dep_count[dependent] -= 1
                    if dep_count[dependent] == 0:
                        queue.append(dependent)

        self._cycles_detected = cycles
        return order

    # ── Mermaid generation ───────────────────────────────────────────

    def _generate_mermaid(
        self,
        graph: dict[str, list[str]],
        metadata: dict[str, RepoMetadata],
    ) -> str:
        """Generate a Mermaid graph TD diagram string from the adjacency map."""
        lines: list[str] = ["graph TD"]

        # Collect all nodes that appear in the graph
        all_nodes: set[str] = set(graph.keys())
        for deps in graph.values():
            all_nodes.update(deps)

        # Build node labels
        for node in sorted(all_nodes):
            meta = metadata.get(node)
            if meta:
                label_parts: list[str] = []
                if meta.languages:
                    label_parts.append(', '.join(meta.languages).title())
                if meta.build_systems:
                    label_parts.append(', '.join(meta.build_systems).title())
                label = f"{node} ({', '.join(label_parts)})" if label_parts else node
            else:
                label = node
            lines.append(f'  {node}["{label}"]')

        # Build edges
        for source in sorted(graph.keys()):
            for target in sorted(graph[source]):
                lines.append(f"  {source} --> {target}")

        return "\n".join(lines)

    # ── Main entry point ─────────────────────────────────────────────

    def discover(self, workspace_dir: str, repo_names: list[str]) -> DiscoveryResult:
        """Main entry point: scan repos, build graph, sort, generate mermaid.

        Args:
            workspace_dir: Path to the directory containing all repo directories.
            repo_names: List of repo directory names to analyze.

        Returns:
            DiscoveryResult with graph, execution order, mermaid diagram, and metadata.
        """
        workspace = Path(workspace_dir)

        # 1. Scan each repo
        repo_metadata: dict[str, RepoMetadata] = {}
        for name in repo_names:
            repo_dir = workspace / name
            if repo_dir.is_dir():
                repo_metadata[name] = self._scan_repo(str(repo_dir))
            else:
                logger.warning(f"Repo directory not found: {repo_dir}")
                repo_metadata[name] = RepoMetadata(name=name)

        # 2. Build dependency graph
        graph = self._build_graph(repo_metadata)

        # 3. Topological sort (also detects/breaks cycles)
        self._cycles_detected: list[tuple[str, str]] = []
        execution_order = self._topological_sort(graph)

        # 4. Generate Mermaid diagram
        mermaid = self._generate_mermaid(graph, repo_metadata)

        return DiscoveryResult(
            dependency_graph=graph,
            execution_order=execution_order,
            mermaid_diagram=mermaid,
            repo_metadata=repo_metadata,
            cycles_detected=self._cycles_detected,
        )

    # ── Helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _xml_text(element, tag: str) -> Optional[str]:
        """Safely extract text from an XML child element."""
        child = element.find(tag)
        return child.text.strip() if child is not None and child.text else None

    @staticmethod
    def _parse_pep508(dep_str: str) -> Optional[tuple[str, str]]:
        """Parse a PEP 508 dependency string into (name, version)."""
        match = re.match(r'^([a-zA-Z0-9_\-\.]+)', dep_str)
        if not match:
            return None
        name = match.group(1)
        ver_match = re.search(r'[><=!~]+\s*([\d][^\s,;]*)', dep_str)
        version = ver_match.group(1) if ver_match else ''
        return name, version
