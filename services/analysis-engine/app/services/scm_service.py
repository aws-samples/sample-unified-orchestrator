"""
Source Code Management Service

Analyzes application source code repositories to extract dependency, testing,
CI/CD, documentation, and monitoring data for risk assessment scoring.

Ported from replatform-analyzer (repository_service.py, dependency_parser.py)
with new analysis methods for testing, CI/CD, docs, and monitoring.
"""

import os
import re
import shutil
import logging
import tempfile
import json
import defusedxml.ElementTree as ET
from typing import Dict, Any, List, Optional
from pathlib import Path
from datetime import datetime

try:
    import git
    from git import Repo, GitCommandError
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False
    logging.warning("GitPython not installed. Install with: pip install GitPython")

logger = logging.getLogger(__name__)


class SCMService:
    """
    Repository analysis service.

    Ported from replatform-analyzer's RepositoryService + DependencyParser,
    plus new analysis methods for testing, CI/CD, docs, and monitoring.
    """

    # Repository size limit (5GB) — ported from RepositoryService
    MAX_REPO_SIZE_BYTES = 5 * 1024 * 1024 * 1024

    # Supported git providers — ported from RepositoryService
    SUPPORTED_PROVIDERS = [
        'github.com', 'gitlab.com', 'bitbucket.org', 'dev.azure.com'
    ]

    # Directories to skip during scanning — ported from DependencyParser
    SKIP_DIRECTORIES = {
        '.git', '.svn', '.hg', 'node_modules', '__pycache__', '.pytest_cache',
        '.tox', 'venv', 'env', '.venv', 'virtualenv', 'target', 'build',
        'dist', 'bin', 'obj', '.idea', '.vscode', '.vs'
    }

    # Dependency file patterns — ported from DependencyParser
    DEPENDENCY_FILES = {
        'java_maven': {'pattern': 'pom.xml', 'ecosystem': 'Java', 'tool': 'Maven'},
        'java_gradle': {'pattern': 'build.gradle', 'ecosystem': 'Java', 'tool': 'Gradle'},
        'java_gradle_kts': {'pattern': 'build.gradle.kts', 'ecosystem': 'Java', 'tool': 'Gradle (Kotlin)'},
        'python_requirements': {'pattern': 'requirements.txt', 'ecosystem': 'Python', 'tool': 'pip'},
        'python_pipfile': {'pattern': 'Pipfile', 'ecosystem': 'Python', 'tool': 'Pipenv'},
        'python_poetry': {'pattern': 'pyproject.toml', 'ecosystem': 'Python', 'tool': 'Poetry'},
        'dotnet_csproj': {'pattern': '*.csproj', 'ecosystem': '.NET', 'tool': 'NuGet'},
        'dotnet_packages': {'pattern': 'packages.config', 'ecosystem': '.NET', 'tool': 'NuGet'},
    }

    def __init__(self):
        """Initialize SCM service."""
        from app.config import Config
        self._git_credential = Config.GITHUB_TOKEN or ''
        self.workspace_dir = Path(tempfile.gettempdir()) / "unified-orchestrator-repos"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        # Log credential status only — never log the token or any part of it (not even a prefix).
        token_status = "present" if self._git_credential else "MISSING"
        token_len = len(self._git_credential) if self._git_credential else 0
        logger.info(
            f"SCMService initialized | workspace={self.workspace_dir} | "
            f"git_token={token_status} (len={token_len}) | "
            f"GitPython available={GIT_AVAILABLE}"
        )

    # -------------------------------------------------------------------------
    # Git clone operations — ported from repository_service.py
    # -------------------------------------------------------------------------

    def _validate_url(self, repository_url: str) -> Dict[str, Any]:
        """Validate repository URL format and provider."""
        if not (repository_url.startswith('https://') or repository_url.startswith('git@')):
            return {"valid": False, "error": "URL must start with 'https://' or 'git@'"}
        provider = None
        for p in self.SUPPORTED_PROVIDERS:
            if p in repository_url:
                provider = p
                break
        if not provider:
            return {"valid": False, "error": f"Unsupported provider. Supported: {', '.join(self.SUPPORTED_PROVIDERS)}"}
        return {"valid": True, "provider": provider, "url": repository_url}

    def _clone_repository(self, repo_url: str) -> Dict[str, Any]:
        """
        Clone a repository locally (shallow, depth=1).
        Ported from RepositoryService.clone_repository().
        """
        if not GIT_AVAILABLE:
            logger.error("GitPython is not installed — cannot clone repositories")
            return {"success": False, "error": "GitPython not installed"}

        validation = self._validate_url(repo_url)
        if not validation["valid"]:
            logger.warning(f"URL validation failed for '{repo_url}': {validation['error']}")
            return {"success": False, "error": validation["error"]}

        logger.info(f"Cloning repository: {repo_url} (provider={validation.get('provider')})")

        # Inject PAT for HTTPS URLs
        clone_url = repo_url
        if self._git_credential and repo_url.startswith('https://'):
            clone_url = repo_url.replace('https://', f'https://{self._git_credential}@')
            logger.info(f"Injected PAT into clone URL (token len={len(self._git_credential)})")
        elif not self._git_credential:
            logger.warning("No GITHUB_TOKEN configured — clone will attempt without authentication")
        elif not repo_url.startswith('https://'):
            logger.info(f"Non-HTTPS URL detected ({repo_url[:20]}...), skipping PAT injection")

        repo_name = self._extract_repo_name(repo_url)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        clone_dir = self.workspace_dir / f"{repo_name}_{timestamp}"
        logger.info(f"Clone target directory: {clone_dir}")

        try:
            logger.info(f"Executing: git clone --depth=1 {repo_url} -> {clone_dir}")
            Repo.clone_from(clone_url, str(clone_dir), depth=1)
            logger.info(f"Clone successful: {clone_dir}")
        except GitCommandError as e:
            stderr = getattr(e, 'stderr', '') or ''
            status = getattr(e, 'status', 'unknown')
            logger.error(
                f"GitCommandError during clone | repo={repo_url} | "
                f"exit_code={status} | stderr={stderr.strip()} | "
                f"token_present={bool(self._git_credential)} | "
                f"token_len={len(self._git_credential) if self._git_credential else 0}"
            )
            if 'Authentication failed' in str(e) or 'could not read Username' in str(e):
                logger.error(
                    f"Authentication failure confirmed | repo={repo_url} | "
                    f"Possible causes: expired token, insufficient scopes, wrong token for this provider"
                )
                return {
                    "success": False,
                    "error": f"Authentication failed (git exit code {status}). "
                             f"Check GITHUB_TOKEN is valid and has repo scope. stderr: {stderr.strip()}",
                }
            return {"success": False, "error": f"Clone failed (exit code {status}): {stderr.strip() or str(e)}"}
        except Exception as e:
            logger.error(f"Unexpected error during clone | repo={repo_url} | error={type(e).__name__}: {e}", exc_info=True)
            return {"success": False, "error": f"Clone failed: {str(e)}"}

        # Check size
        repo_size = self._get_directory_size(clone_dir)
        if repo_size > self.MAX_REPO_SIZE_BYTES:
            self._cleanup_repository(str(clone_dir))
            return {"success": False, "error": f"Repo size ({repo_size / (1024**3):.2f} GB) exceeds 5 GB limit"}

        logger.info(f"Clone complete | repo={repo_url} | size={repo_size / (1024**2):.1f} MB | path={clone_dir}")
        return {
            "success": True,
            "local_path": str(clone_dir),
            "size_bytes": repo_size,
        }

    def _cleanup_repository(self, local_path: str):
        """Remove cloned repository directory."""
        try:
            if os.path.exists(local_path):
                shutil.rmtree(local_path, ignore_errors=True)
                logger.info(f"Cleaned up: {local_path}")
        except Exception as e:
            logger.warning(f"Cleanup failed for {local_path}: {e}")

    def _extract_repo_name(self, repo_url: str) -> str:
        """Extract repository name from URL."""
        url = repo_url.rstrip('/')
        if url.endswith('.git'):
            url = url[:-4]
        parts = url.split('/')
        return parts[-1] if parts else 'repo'

    def _get_directory_size(self, path) -> int:
        """Calculate total directory size in bytes."""
        total = 0
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if os.path.exists(fp):
                    total += os.path.getsize(fp)
        return total

    # -------------------------------------------------------------------------
    # Dependency file detection — ported from dependency_parser.py
    # -------------------------------------------------------------------------

    def _detect_dependency_files(self, repo_path: str) -> Dict[str, Any]:
        """
        Detect all dependency files in a cloned repository.
        Ported from DependencyParser.detect_dependency_files().
        """
        root = Path(repo_path)
        if not root.exists():
            return {"success": False, "error": f"Path does not exist: {repo_path}"}

        logger.info(f"Scanning for dependency files: {repo_path}")
        detected = []

        for file_type, config in self.DEPENDENCY_FILES.items():
            pattern = config['pattern']
            if '*' in pattern:
                files = self._find_files_by_extension(root, pattern)
            else:
                files = self._find_files_by_name(root, pattern)

            for fp in files:
                detected.append({
                    'file_path': str(fp),
                    'relative_path': str(fp.relative_to(root)),
                    'file_name': fp.name,
                    'file_type': file_type,
                    'ecosystem': config['ecosystem'],
                    'tool': config['tool'],
                })

        # Group by ecosystem
        by_ecosystem: Dict[str, list] = {}
        for f in detected:
            by_ecosystem.setdefault(f['ecosystem'], []).append(f)

        logger.info(f"Detected {len(detected)} dependency files across {list(by_ecosystem.keys())}")
        return {
            "success": True,
            "total_files": len(detected),
            "files": detected,
            "by_ecosystem": by_ecosystem,
        }

    def _find_files_by_name(self, root_path: Path, filename: str) -> List[Path]:
        """Find files with exact name match, skipping excluded dirs."""
        results = []
        for dirpath, dirnames, filenames in os.walk(root_path):
            dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRECTORIES]
            if filename in filenames:
                results.append(Path(dirpath) / filename)
        return results

    def _find_files_by_extension(self, root_path: Path, pattern: str) -> List[Path]:
        """Find files matching wildcard pattern (e.g. *.csproj)."""
        ext = pattern.replace('*', '')
        results = []
        for dirpath, dirnames, filenames in os.walk(root_path):
            dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRECTORIES]
            for fn in filenames:
                if fn.endswith(ext):
                    results.append(Path(dirpath) / fn)
        return results

    # -------------------------------------------------------------------------
    # Dependency parsing — routes to ported parsers
    # Adapted from repository_analysis_agent._run_analysis()
    # -------------------------------------------------------------------------

    def _parse_dependencies(self, detected_files: Dict[str, Any], repo_url: str) -> List[Dict[str, Any]]:
        """
        Parse all detected dependency files using the appropriate parser.
        Adapted from repository_analysis_agent._run_analysis().
        """
        from app.parsers.java_maven_parser import MavenParser
        from app.parsers.java_gradle_parser import GradleParser
        from app.parsers.python_requirements_parser import RequirementsParser
        from app.parsers.python_pipfile_parser import PipfileParser
        from app.parsers.python_poetry_parser import PoetryParser
        from app.parsers.dotnet_csproj_parser import CsprojParser
        from app.parsers.dotnet_packages_parser import PackagesConfigParser

        maven_parser = MavenParser()
        gradle_parser = GradleParser()
        requirements_parser = RequirementsParser()
        pipfile_parser = PipfileParser()
        poetry_parser = PoetryParser()
        csproj_parser = CsprojParser()
        packages_parser = PackagesConfigParser()

        all_deps: List[Dict[str, Any]] = []
        warnings: List[str] = []
        by_ecosystem = detected_files.get('by_ecosystem', {})

        # --- Java ---
        for file_info in by_ecosystem.get('Java', []):
            try:
                fp = file_info['file_path']
                fn = file_info['file_name']
                if 'pom.xml' in fn:
                    result = maven_parser.parse_pom(fp)
                elif 'build.gradle' in fn:
                    result = gradle_parser.parse_gradle(fp)
                else:
                    continue
                if result.get('success'):
                    for dep in result.get('dependencies', []):
                        dep['ecosystem'] = 'Java'
                        dep['source_file'] = file_info['relative_path']
                        dep['repository_url'] = repo_url
                    all_deps.extend(result.get('dependencies', []))
                else:
                    warnings.append(f"Parse failed for {fn}: {result.get('error')}")
            except Exception as e:
                warnings.append(f"Error parsing {file_info.get('file_name')}: {e}")

        # --- Python ---
        for file_info in by_ecosystem.get('Python', []):
            try:
                fp = file_info['file_path']
                fn = file_info['file_name']
                if fn == 'requirements.txt':
                    result = requirements_parser.parse_requirements(fp)
                elif fn == 'Pipfile':
                    result = pipfile_parser.parse_pipfile(fp)
                elif fn == 'pyproject.toml':
                    result = poetry_parser.parse_poetry(fp)
                else:
                    continue
                if result.get('success'):
                    for dep in result.get('dependencies', []):
                        dep['ecosystem'] = 'Python'
                        dep['source_file'] = file_info['relative_path']
                        dep['repository_url'] = repo_url
                    all_deps.extend(result.get('dependencies', []))
                else:
                    warnings.append(f"Parse failed for {fn}: {result.get('error')}")
            except Exception as e:
                warnings.append(f"Error parsing {file_info.get('file_name')}: {e}")

        # --- .NET ---
        for file_info in by_ecosystem.get('.NET', []):
            try:
                fp = file_info['file_path']
                fn = file_info['file_name']
                if fn.endswith('.csproj'):
                    result = csproj_parser.parse_csproj(fp)
                elif fn == 'packages.config':
                    result = packages_parser.parse_packages_config(fp)
                else:
                    continue
                if result.get('success'):
                    for dep in result.get('dependencies', []):
                        dep['ecosystem'] = '.NET'
                        dep['source_file'] = file_info['relative_path']
                        dep['repository_url'] = repo_url
                    all_deps.extend(result.get('dependencies', []))
                else:
                    warnings.append(f"Parse failed for {fn}: {result.get('error')}")
            except Exception as e:
                warnings.append(f"Error parsing {file_info.get('file_name')}: {e}")

        # Deduplicate (same name + version from different files)
        all_deps = self._deduplicate_dependencies(all_deps)

        logger.info(f"Parsed {len(all_deps)} unique dependencies ({len(warnings)} warnings)")
        return all_deps

    def _deduplicate_dependencies(self, deps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove duplicate dependencies (same name + version)."""
        seen = set()
        unique = []
        for dep in deps:
            key = (dep.get('name', ''), dep.get('version', ''), dep.get('ecosystem', ''))
            if key not in seen:
                seen.add(key)
                unique.append(dep)
        return unique

    # -------------------------------------------------------------------------
    # Classification + normalization — ported from dependency_classifier.py
    # and version_normalizer.py
    # -------------------------------------------------------------------------

    def _classify_and_normalize(self, dependencies: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Classify each dependency by type and normalize version strings.
        Wires ported DependencyClassifier and VersionNormalizer into the pipeline.

        Returns dict with classified deps, integration count, and category summary.
        """
        from app.services.dependency_classifier import DependencyClassifier
        from app.services.version_normalizer import VersionNormalizer

        classifier = DependencyClassifier()
        normalizer = VersionNormalizer()

        # Classify
        dependencies = classifier.classify_batch(dependencies)

        # Normalize versions
        for dep in dependencies:
            version_str = dep.get('version') or dep.get('version_spec', '')
            result = normalizer.normalize(version_str)
            dep['normalized_version'] = result.get('normalized')
            dep['version_needs_lookup'] = result.get('needs_lookup', False)

        # Compute integration count (non-Library, non-Testing, non-Unknown deps)
        integration_categories = {'Database', 'Middleware', 'Framework', 'Web Server',
                                  'ORM', 'Security', 'HTTP Client'}
        integration_count = sum(
            1 for dep in dependencies
            if dep.get('classification') in integration_categories
        )

        # Category summary
        category_counts: Dict[str, int] = {}
        for dep in dependencies:
            cat = dep.get('classification', 'Unknown')
            category_counts[cat] = category_counts.get(cat, 0) + 1

        logger.info(f"Classified {len(dependencies)} deps: {category_counts}, integrations={integration_count}")

        return {
            'dependencies': dependencies,
            'integration_count': integration_count,
            'total_count': len(dependencies),
            'category_summary': category_counts,
        }

    # -------------------------------------------------------------------------
    # Language version detection — Task 1.4
    # -------------------------------------------------------------------------

    def _detect_language_version(self, repo_path: str) -> Dict[str, Any]:
        """
        Detect the primary language and its version from config files in the repo.

        Scans for:
        - Java: pom.xml (<java.version>, <maven.compiler.source>), build.gradle (sourceCompatibility)
        - Node.js: package.json (engines.node), .nvmrc, .node-version
        - Python: Pipfile (python_version), pyproject.toml, .python-version, runtime.txt

        Returns:
            { 'language': str, 'current_version': str, 'major_version': int }
        """
        root = Path(repo_path)
        result = {'language': 'Unknown', 'current_version': None, 'major_version': None}

        # Try Java first
        java_version = self._detect_java_version(root)
        if java_version:
            return java_version

        # Try Node.js
        node_version = self._detect_node_version(root)
        if node_version:
            return node_version

        # Try Python
        python_version = self._detect_python_version(root)
        if python_version:
            return python_version

        logger.info("Could not detect language version from config files")
        return result

    def _detect_java_version(self, root: Path) -> Optional[Dict[str, Any]]:
        """Detect Java version from pom.xml or build.gradle."""
        # Check pom.xml
        pom_files = self._find_files_by_name(root, 'pom.xml')
        for pom_path in pom_files:
            try:
                tree = ET.parse(str(pom_path))
                root_el = tree.getroot()
                ns = ''
                # Handle Maven namespace
                if root_el.tag.startswith('{'):
                    ns = root_el.tag.split('}')[0] + '}'

                # Check <properties><java.version>
                props = root_el.find(f'{ns}properties')
                if props is not None:
                    for tag in ['java.version', 'maven.compiler.source', 'maven.compiler.target']:
                        el = props.find(f'{ns}{tag}')
                        if el is not None and el.text:
                            ver = el.text.strip()
                            major = self._extract_major_version(ver)
                            return {'language': 'Java', 'current_version': ver, 'major_version': major}

                # Check <maven.compiler.source> at top level (some POMs)
                for tag in ['maven.compiler.source', 'maven.compiler.target']:
                    el = root_el.find(f'.//{ns}{tag}')
                    if el is not None and el.text:
                        ver = el.text.strip()
                        major = self._extract_major_version(ver)
                        return {'language': 'Java', 'current_version': ver, 'major_version': major}
            except Exception as e:
                logger.debug(f"Error parsing {pom_path} for Java version: {e}")

        # Check build.gradle
        gradle_files = self._find_files_by_name(root, 'build.gradle')
        gradle_files.extend(self._find_files_by_name(root, 'build.gradle.kts'))
        for gradle_path in gradle_files:
            try:
                content = gradle_path.read_text(errors='ignore')
                # sourceCompatibility = '11' or sourceCompatibility = JavaVersion.VERSION_17
                match = re.search(
                    r'sourceCompatibility\s*[=:]\s*[\'"]?(?:JavaVersion\.VERSION_)?(\d[\d.]*)',
                    content
                )
                if match:
                    ver = match.group(1)
                    major = self._extract_major_version(ver)
                    return {'language': 'Java', 'current_version': ver, 'major_version': major}
            except Exception as e:
                logger.debug(f"Error reading {gradle_path} for Java version: {e}")

        return None

    def _detect_node_version(self, root: Path) -> Optional[Dict[str, Any]]:
        """Detect Node.js version from package.json, .nvmrc, or .node-version."""
        # Check package.json engines.node
        pkg_files = self._find_files_by_name(root, 'package.json')
        for pkg_path in pkg_files:
            try:
                data = json.loads(pkg_path.read_text(errors='ignore'))
                node_ver = data.get('engines', {}).get('node')
                if node_ver:
                    # Extract version number from range like ">=18.0.0"
                    clean = re.search(r'(\d+[\d.]*)', node_ver)
                    if clean:
                        ver = clean.group(1)
                        major = self._extract_major_version(ver)
                        return {'language': 'Node.js', 'current_version': ver, 'major_version': major}
            except Exception as e:
                logger.debug(f"Error reading {pkg_path} for Node version: {e}")

        # Check .nvmrc
        nvmrc_files = self._find_files_by_name(root, '.nvmrc')
        for nvmrc_path in nvmrc_files:
            try:
                ver = nvmrc_path.read_text(errors='ignore').strip().lstrip('v')
                if ver and ver[0].isdigit():
                    major = self._extract_major_version(ver)
                    return {'language': 'Node.js', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        # Check .node-version
        nv_files = self._find_files_by_name(root, '.node-version')
        for nv_path in nv_files:
            try:
                ver = nv_path.read_text(errors='ignore').strip().lstrip('v')
                if ver and ver[0].isdigit():
                    major = self._extract_major_version(ver)
                    return {'language': 'Node.js', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        return None

    def _detect_python_version(self, root: Path) -> Optional[Dict[str, Any]]:
        """Detect Python version from Pipfile, pyproject.toml, .python-version, or runtime.txt."""
        # Check Pipfile
        pipfiles = self._find_files_by_name(root, 'Pipfile')
        for pf_path in pipfiles:
            try:
                content = pf_path.read_text(errors='ignore')
                match = re.search(r'python_version\s*=\s*["\'](\d[\d.]*)', content)
                if match:
                    ver = match.group(1)
                    major = self._extract_major_version(ver)
                    return {'language': 'Python', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        # Check pyproject.toml
        pyproject_files = self._find_files_by_name(root, 'pyproject.toml')
        for pp_path in pyproject_files:
            try:
                content = pp_path.read_text(errors='ignore')
                # requires-python = ">=3.10"
                match = re.search(r'requires-python\s*=\s*["\']>=?\s*(\d[\d.]*)', content)
                if match:
                    ver = match.group(1)
                    major = self._extract_major_version(ver)
                    return {'language': 'Python', 'current_version': ver, 'major_version': major}
                # python_version in tool.poetry section
                match = re.search(r'python\s*=\s*["\'][\^~>=]*(\d[\d.]*)', content)
                if match:
                    ver = match.group(1)
                    major = self._extract_major_version(ver)
                    return {'language': 'Python', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        # Check .python-version
        pv_files = self._find_files_by_name(root, '.python-version')
        for pv_path in pv_files:
            try:
                ver = pv_path.read_text(errors='ignore').strip()
                if ver and ver[0].isdigit():
                    major = self._extract_major_version(ver)
                    return {'language': 'Python', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        # Check runtime.txt (Heroku-style: python-3.11.5)
        rt_files = self._find_files_by_name(root, 'runtime.txt')
        for rt_path in rt_files:
            try:
                content = rt_path.read_text(errors='ignore').strip()
                match = re.search(r'python-?(\d[\d.]*)', content, re.IGNORECASE)
                if match:
                    ver = match.group(1)
                    major = self._extract_major_version(ver)
                    return {'language': 'Python', 'current_version': ver, 'major_version': major}
            except Exception:
                pass

        # Check setup.py / setup.cfg for python_requires
        for fname in ('setup.py', 'setup.cfg'):
            setup_files = self._find_files_by_name(root, fname)
            for sf_path in setup_files:
                try:
                    content = sf_path.read_text(errors='ignore')
                    match = re.search(r'python_requires\s*[=:]\s*["\']?>=?\s*(\d[\d.]*)', content)
                    if match:
                        ver = match.group(1)
                        major = self._extract_major_version(ver)
                        return {'language': 'Python', 'current_version': ver, 'major_version': major}
                except Exception:
                    pass

        # Fallback: if requirements.txt exists, we know it's Python but version is unknown
        req_files = self._find_files_by_name(root, 'requirements.txt')
        if req_files:
            return {'language': 'Python', 'current_version': 'Not specified', 'major_version': 3}

        return None

    def _extract_major_version(self, version_str: str) -> Optional[int]:
        """Extract major version number from a version string."""
        try:
            # Handle Java versions like "1.8" (means Java 8) vs "11", "17"
            parts = version_str.split('.')
            major = int(parts[0])
            if major == 1 and len(parts) > 1:
                # Java 1.8 = Java 8
                return int(parts[1])
            return major
        except (ValueError, IndexError):
            return None

    # -------------------------------------------------------------------------
    # Application type detection — Task 1.5
    # -------------------------------------------------------------------------

    # Framework indicators for application type detection
    APP_TYPE_INDICATORS = {
        'REST API': {
            'dependencies': [
                'spring-boot-starter-web', 'spring-boot-starter-webflux',
                'express', 'fastify', 'koa', 'hapi',
                'flask', 'fastapi', 'django-rest-framework', 'djangorestframework',
                'asp.net', 'webapi',
            ],
            'files': [],
        },
        'Web Application': {
            'dependencies': [
                'react', 'react-dom', 'angular', '@angular/core', 'vue',
                'next', 'nuxt', 'gatsby',
                'django', 'spring-boot-starter-thymeleaf', 'jsp-api',
                'blazor',
            ],
            'files': ['src/index.html', 'public/index.html', 'templates/'],
        },
        'Event-Driven': {
            'dependencies': [
                'spring-kafka', 'kafka-clients', 'kafka',
                'amqplib', 'rabbitmq', 'spring-rabbit', 'spring-amqp',
                'aws-sdk-sqs', 'boto3-sqs', '@aws-sdk/client-sqs',
                'aws-sdk-sns', '@aws-sdk/client-sns',
            ],
            'files': [],
        },
        'Socket-Based': {
            'dependencies': [
                'socket.io', 'ws', 'websocket',
                'netty', 'spring-boot-starter-websocket',
            ],
            'files': [],
        },
    }

    def _detect_application_type(self, repo_path: str, dependencies: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Detect application type from framework indicators and dependency list.

        Returns:
            { 'type': str, 'framework': str, 'label': str }
        """
        root = Path(repo_path)
        dep_names = set()
        for dep in dependencies:
            name = (dep.get('name') or dep.get('package_name') or dep.get('artifact_id') or '').lower()
            dep_names.add(name)
            # Also add just the artifact part for Maven deps like "org.springframework:spring-core"
            if ':' in name:
                dep_names.add(name.split(':')[-1])

        matched_type = 'Unknown'
        matched_framework = 'Unknown'

        for app_type, indicators in self.APP_TYPE_INDICATORS.items():
            for kw in indicators['dependencies']:
                kw_lower = kw.lower()
                for dn in dep_names:
                    if kw_lower in dn or dn in kw_lower:
                        matched_type = app_type
                        matched_framework = kw
                        break
                if matched_type != 'Unknown':
                    break
            if matched_type != 'Unknown':
                break

        # Check for containerization
        is_containerized = any(
            (root / f).exists()
            for f in ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']
        )

        # Build label
        if matched_type != 'Unknown':
            label = f"{matched_framework} {matched_type}"
        elif is_containerized:
            label = "Containerized Application"
            matched_type = "Containerized"
        else:
            label = "Unknown Application Type"

        logger.info(f"Detected application type: {matched_type} ({matched_framework})")
        return {
            'type': matched_type,
            'framework': matched_framework,
            'label': label,
            'is_containerized': is_containerized,
        }

    # -------------------------------------------------------------------------
    # Testing maturity analysis — Task 1.6
    # -------------------------------------------------------------------------

    TEST_DIRECTORIES = [
        'src/test', 'src/tests', 'test', 'tests', '__tests__',
        'spec', 'specs', 'test_', 'e2e', 'integration-tests',
    ]

    TEST_FILE_PATTERNS = [
        r'.*[Tt]est.*\.(java|py|ts|tsx|js|jsx|cs)$',
        r'.*[Ss]pec.*\.(ts|tsx|js|jsx|rb)$',
        r'.*_test\.(py|go)$',
        r'test_.*\.py$',
    ]

    TEST_FRAMEWORKS = {
        'JUnit': ['junit', 'junit-jupiter', 'junit-platform'],
        'TestNG': ['testng'],
        'Mockito': ['mockito'],
        'pytest': ['pytest'],
        'unittest': ['unittest'],
        'Jest': ['jest'],
        'Mocha': ['mocha'],
        'Jasmine': ['jasmine'],
        'xUnit': ['xunit'],
        'NUnit': ['nunit'],
        'MSTest': ['mstest'],
    }

    INTEGRATION_TEST_INDICATORS = [
        'testcontainers', 'spring-boot-starter-test',
        'supertest', 'cypress', 'selenium', 'playwright',
        'wiremock', 'rest-assured', 'httptest',
    ]

    E2E_INDICATORS = [
        'cypress', 'playwright', 'selenium', 'puppeteer',
        'protractor', 'nightwatch', 'webdriverio',
    ]

    def _analyze_testing(self, repo_path: str) -> Dict[str, Any]:
        """
        Analyze test presence, frameworks, and maturity.

        Returns:
            { 'has_tests': bool, 'frameworks': [...], 'has_unit': bool,
              'has_integration': bool, 'has_e2e': bool,
              'estimated_coverage': int, 'maturity': str }
        """
        root = Path(repo_path)
        result = {
            'has_tests': False,
            'frameworks': [],
            'has_unit': False,
            'has_integration': False,
            'has_e2e': False,
            'estimated_coverage': 0,
            'maturity': 'No Tests',
            'test_file_count': 0,
            'total_source_files': 0,
            'test_directories': [],
            'details': [],
        }

        # Check for test directories
        has_test_dir = False
        found_test_dirs = []
        for td in self.TEST_DIRECTORIES:
            if (root / td).is_dir():
                has_test_dir = True
                found_test_dirs.append(td)
        result['test_directories'] = found_test_dirs

        # Count test files
        test_file_count = 0
        total_source_files = 0
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRECTORIES]
            for fn in filenames:
                if fn.endswith(('.java', '.py', '.ts', '.tsx', '.js', '.jsx', '.cs', '.go', '.rb')):
                    total_source_files += 1
                    for pattern in self.TEST_FILE_PATTERNS:
                        if re.match(pattern, fn):
                            test_file_count += 1
                            break

        result['has_tests'] = test_file_count > 0 or has_test_dir

        # Detect test frameworks from dependencies
        # We need to check dependency files since we don't have parsed deps here
        dep_detection = self._detect_dependency_files(repo_path)
        all_file_content = ''
        for f_info in dep_detection.get('files', []):
            try:
                all_file_content += Path(f_info['file_path']).read_text(errors='ignore').lower()
            except Exception:
                pass
        # Also scan package.json (not in DEPENDENCY_FILES but contains dep info)
        for pkg_json in self._find_files_by_name(root, 'package.json'):
            try:
                all_file_content += pkg_json.read_text(errors='ignore').lower()
            except Exception:
                pass

        detected_frameworks = []
        for fw_name, keywords in self.TEST_FRAMEWORKS.items():
            for kw in keywords:
                if kw in all_file_content:
                    detected_frameworks.append(fw_name)
                    break
        result['frameworks'] = detected_frameworks

        # Detect integration tests
        has_integration = False
        for indicator in self.INTEGRATION_TEST_INDICATORS:
            if indicator in all_file_content:
                has_integration = True
                break
        # Also check for integration test directories
        for td in ['src/test/integration', 'integration-tests', 'tests/integration']:
            if (root / td).is_dir():
                has_integration = True
                break

        # Detect e2e tests
        has_e2e = False
        for indicator in self.E2E_INDICATORS:
            if indicator in all_file_content:
                has_e2e = True
                break
        for td in ['e2e', 'tests/e2e', 'cypress']:
            if (root / td).is_dir():
                has_e2e = True
                break

        result['has_unit'] = test_file_count > 0 or len(detected_frameworks) > 0
        result['has_integration'] = has_integration
        result['has_e2e'] = has_e2e
        result['test_file_count'] = test_file_count
        result['total_source_files'] = total_source_files

        # Estimate coverage based on test-to-source ratio
        if total_source_files > 0 and test_file_count > 0:
            ratio = test_file_count / total_source_files
            result['estimated_coverage'] = min(int(ratio * 100), 95)
            result['coverage_source'] = 'file-ratio'
        elif result['has_tests']:
            result['estimated_coverage'] = 20  # Has tests but can't measure ratio
            result['coverage_source'] = 'file-ratio'

        # Try to find actual coverage reports — overrides file-ratio if found
        report_coverage = self._parse_coverage_reports(repo_path)
        if report_coverage is not None:
            result['estimated_coverage'] = report_coverage
            result['coverage_source'] = 'coverage-report'

        # Determine maturity
        if has_e2e and has_integration and result['has_unit']:
            result['maturity'] = 'Full Pyramid'
        elif has_integration and result['has_unit']:
            result['maturity'] = 'Unit + Integration'
        elif result['has_unit']:
            result['maturity'] = 'Unit Only'
        else:
            result['maturity'] = 'No Tests'

        logger.info(f"Testing analysis: {result['maturity']}, frameworks={detected_frameworks}, "
                     f"test_files={test_file_count}/{total_source_files}")

        # Build details list for frontend table
        details = []
        if detected_frameworks:
            details.append({
                'aspect': 'Test Frameworks',
                'status': 'Detected',
                'detail': ', '.join(detected_frameworks),
            })
        else:
            details.append({
                'aspect': 'Test Frameworks',
                'status': 'Not Found',
                'detail': 'No known test frameworks detected in dependencies',
            })
        details.append({
            'aspect': 'Unit Tests',
            'status': 'Yes' if result['has_unit'] else 'No',
            'detail': f"{test_file_count} test file{'s' if test_file_count != 1 else ''} found"
                      + (f" in {', '.join(found_test_dirs)}" if found_test_dirs else ''),
        })
        details.append({
            'aspect': 'Integration Tests',
            'status': 'Yes' if has_integration else 'No',
            'detail': 'Integration test indicators detected' if has_integration
                      else 'No integration test indicators found',
        })
        details.append({
            'aspect': 'E2E Tests',
            'status': 'Yes' if has_e2e else 'No',
            'detail': 'End-to-end test indicators detected' if has_e2e
                      else 'No e2e test indicators found',
        })
        result['details'] = details

        return result

    def _parse_coverage_reports(self, repo_path: str) -> int | None:
        """
        Search for committed coverage report files and extract actual coverage %.

        Supported formats:
        - JaCoCo XML (jacoco.xml) — Java
        - Cobertura XML (coverage.xml, cobertura.xml) — Python/JS/multi-lang
        - lcov (lcov.info, coverage.lcov) — JS/TS
        - pytest-cov / coverage.py (.coverage, htmlcov/) — Python
        - Go (cover.out, coverage.out) — Go

        Returns:
            Integer coverage percentage (0-100) if a report was found, else None.
        """
        root = Path(repo_path)

        # Map of filename patterns to parser functions
        report_files = {
            'jacoco.xml': self._parse_jacoco_xml,
            'coverage.xml': self._parse_cobertura_xml,
            'cobertura.xml': self._parse_cobertura_xml,
            'lcov.info': self._parse_lcov,
            'coverage.lcov': self._parse_lcov,
            'cover.out': self._parse_go_cover,
            'coverage.out': self._parse_go_cover,
        }

        for filename, parser in report_files.items():
            matches = self._find_files_by_name(root, filename)
            for match in matches:
                try:
                    coverage = parser(match)
                    if coverage is not None:
                        logger.info(f"Parsed coverage from {match}: {coverage}%")
                        return coverage
                except Exception as e:
                    logger.warning(f"Failed to parse coverage report {match}: {e}")

        return None

    def _parse_jacoco_xml(self, file_path: Path) -> int | None:
        """Parse JaCoCo XML report for line coverage."""
        tree = ET.parse(str(file_path))
        root_el = tree.getroot()
        # JaCoCo top-level <counter> elements; look for type="LINE"
        for counter in root_el.findall('.//counter[@type="LINE"]'):
            missed = int(counter.get('missed', 0))
            covered = int(counter.get('covered', 0))
            total = missed + covered
            if total > 0:
                return int((covered / total) * 100)
        # Fallback: try INSTRUCTION counter
        for counter in root_el.findall('.//counter[@type="INSTRUCTION"]'):
            missed = int(counter.get('missed', 0))
            covered = int(counter.get('covered', 0))
            total = missed + covered
            if total > 0:
                return int((covered / total) * 100)
        return None

    def _parse_cobertura_xml(self, file_path: Path) -> int | None:
        """Parse Cobertura XML report (used by pytest-cov, Istanbul, etc.)."""
        tree = ET.parse(str(file_path))
        root_el = tree.getroot()
        # Cobertura stores line-rate as a float 0.0-1.0 on the root <coverage> element
        line_rate = root_el.get('line-rate')
        if line_rate is not None:
            return int(float(line_rate) * 100)
        return None

    def _parse_lcov(self, file_path: Path) -> int | None:
        """Parse lcov.info / coverage.lcov for line coverage."""
        lines_found = 0
        lines_hit = 0
        content = file_path.read_text(errors='ignore')
        for line in content.splitlines():
            if line.startswith('LF:'):
                lines_found += int(line[3:])
            elif line.startswith('LH:'):
                lines_hit += int(line[3:])
        if lines_found > 0:
            return int((lines_hit / lines_found) * 100)
        return None

    def _parse_go_cover(self, file_path: Path) -> int | None:
        """Parse Go coverage profile (cover.out)."""
        content = file_path.read_text(errors='ignore')
        total_stmts = 0
        covered_stmts = 0
        for line in content.splitlines():
            if line.startswith('mode:'):
                continue
            # Format: file:startLine.startCol,endLine.endCol numStatements count
            parts = line.split()
            if len(parts) >= 3:
                try:
                    stmts = int(parts[1])
                    count = int(parts[2])
                    total_stmts += stmts
                    if count > 0:
                        covered_stmts += stmts
                except (ValueError, IndexError):
                    pass
        if total_stmts > 0:
            return int((covered_stmts / total_stmts) * 100)
        return None

    # -------------------------------------------------------------------------
    # CI/CD, Documentation, Monitoring detection — Task 1.7
    # -------------------------------------------------------------------------

    CICD_CONFIGS = {
        'GitHub Actions': ['.github/workflows'],
        'Jenkins': ['Jenkinsfile', 'jenkins/Jenkinsfile'],
        'GitLab CI': ['.gitlab-ci.yml'],
        'AWS CodeBuild': ['buildspec.yml', 'buildspec.yaml'],
        'CircleCI': ['.circleci/config.yml', '.circleci'],
        'Azure Pipelines': ['azure-pipelines.yml'],
        'Travis CI': ['.travis.yml'],
        'Bitbucket Pipelines': ['bitbucket-pipelines.yml'],
    }

    # Infrastructure-as-Code tools that indicate deployment automation
    IAC_CONFIGS = {
        'AWS CDK': ['cdk.json', 'cdk/'],
        'AWS SAM': ['template.yaml', 'template.yml', 'sam-template.yaml'],
        'Terraform': ['main.tf', 'terraform/'],
        'CloudFormation': ['cloudformation/', 'cfn-template.yaml', 'cfn-template.json'],
        'Pulumi': ['Pulumi.yaml'],
        'Serverless': ['serverless.yml', 'serverless.yaml'],
    }

    def _detect_cicd(self, repo_path: str) -> Dict[str, Any]:
        """
        Detect CI/CD configuration, IaC tools, and maturity.

        Returns:
            { 'has_pipeline': bool, 'tool': str, 'stages': [...], 'maturity': str,
              'has_iac': bool, 'iac_tool': str }
        """
        root = Path(repo_path)
        result = {
            'has_pipeline': False,
            'tool': 'None',
            'stages': [],
            'maturity': 'none',
            'has_iac': False,
            'iac_tool': 'None',
        }

        # Detect CI/CD pipeline configs
        for tool_name, paths in self.CICD_CONFIGS.items():
            for p in paths:
                target = root / p
                if target.exists():
                    result['has_pipeline'] = True
                    result['tool'] = tool_name

                    # Try to detect stages from file content
                    stages = self._extract_cicd_stages(target, tool_name)
                    result['stages'] = stages
                    break
            if result['has_pipeline']:
                break

        # Detect IaC tools (deployment automation)
        for iac_name, paths in self.IAC_CONFIGS.items():
            for p in paths:
                target = root / p
                if target.exists():
                    result['has_iac'] = True
                    result['iac_tool'] = iac_name
                    break
            if result['has_iac']:
                break

        # Determine maturity
        stages = result['stages']
        has_build = any(s in stages for s in ['build', 'compile', 'package'])
        has_test = any(s in stages for s in ['test', 'verify', 'check'])
        has_deploy = any(s in stages for s in ['deploy', 'release', 'publish']) or result['has_iac']

        if has_build and has_test and has_deploy:
            result['maturity'] = 'full CI/CD'
        elif has_build and has_test:
            result['maturity'] = 'CI only'
        elif has_build:
            result['maturity'] = 'build only'
        elif result['has_pipeline']:
            result['maturity'] = 'basic CI/CD'
        elif result['has_iac']:
            result['maturity'] = 'IaC only'
        else:
            result['maturity'] = 'none'

        # Combine tool name if both pipeline and IaC detected
        if result['has_pipeline'] and result['has_iac']:
            result['tool'] = f"{result['tool']} + {result['iac_tool']}"
        elif result['has_iac'] and not result['has_pipeline']:
            result['tool'] = result['iac_tool']

        logger.info(f"CI/CD detection: tool={result['tool']}, maturity={result['maturity']}, iac={result['iac_tool']}")
        return result

    def _extract_cicd_stages(self, config_path: Path, tool_name: str) -> List[str]:
        """Extract stage names from CI/CD config files."""
        stages = []
        try:
            if config_path.is_dir():
                # GitHub Actions: read all workflow files
                for wf in config_path.glob('*.yml'):
                    content = wf.read_text(errors='ignore').lower()
                    stages.extend(self._extract_stages_from_yaml(content))
                for wf in config_path.glob('*.yaml'):
                    content = wf.read_text(errors='ignore').lower()
                    stages.extend(self._extract_stages_from_yaml(content))
            else:
                content = config_path.read_text(errors='ignore').lower()
                stages.extend(self._extract_stages_from_yaml(content))
        except Exception as e:
            logger.debug(f"Error reading CI/CD config {config_path}: {e}")
        return list(set(stages))

    def _extract_stages_from_yaml(self, content: str) -> List[str]:
        """Extract common stage keywords from YAML content."""
        stages = []
        stage_keywords = {
            'build': ['build', 'compile', 'package', 'assemble'],
            'test': ['test', 'verify', 'check', 'lint', 'analyze'],
            'deploy': ['deploy', 'release', 'publish', 'push'],
            'security': ['security', 'scan', 'sast', 'dast', 'snyk', 'sonar'],
        }
        for stage, keywords in stage_keywords.items():
            for kw in keywords:
                if kw in content:
                    stages.append(stage)
                    break
        return stages

    def _assess_documentation(self, repo_path: str) -> Dict[str, Any]:
        """
        Assess documentation quality.

        Returns:
            { 'has_readme': bool, 'has_api_docs': bool,
              'has_architecture': bool, 'quality': str }
        """
        root = Path(repo_path)
        result = {
            'has_readme': False,
            'readme_length': 0,
            'has_api_docs': False,
            'has_architecture': False,
            'quality': 'none',
        }

        # Check README
        for readme_name in ['README.md', 'README.rst', 'README.txt', 'README', 'readme.md']:
            readme_path = root / readme_name
            if readme_path.exists():
                result['has_readme'] = True
                try:
                    result['readme_length'] = len(readme_path.read_text(errors='ignore'))
                except Exception:
                    pass
                break

        # Check API docs (swagger/openapi)
        api_doc_patterns = [
            'swagger.json', 'swagger.yaml', 'swagger.yml',
            'openapi.json', 'openapi.yaml', 'openapi.yml',
            'api-docs', 'apidoc.json',
        ]
        for pattern in api_doc_patterns:
            matches = self._find_files_by_name(root, pattern)
            if matches:
                result['has_api_docs'] = True
                break
        # Also check for docs directory with API content
        for docs_dir in ['docs', 'doc', 'documentation']:
            if (root / docs_dir).is_dir():
                result['has_api_docs'] = True
                break

        # Check architecture docs
        arch_indicators = ['.drawio', '.puml', '.plantuml']
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRECTORIES]
            for fn in filenames:
                if any(fn.endswith(ext) for ext in arch_indicators):
                    result['has_architecture'] = True
                    break
            if result['has_architecture']:
                break
        # Also check for architecture markdown files
        for docs_dir in ['docs', 'doc', 'documentation', 'architecture']:
            if (root / docs_dir).is_dir():
                result['has_architecture'] = True
                break

        # Determine quality
        score = 0
        if result['has_readme']:
            score += 1
            if result['readme_length'] > 500:
                score += 1  # Substantial README
        if result['has_api_docs']:
            score += 1
        if result['has_architecture']:
            score += 1

        quality_map = {0: 'none', 1: 'minimal', 2: 'basic', 3: 'good', 4: 'comprehensive'}
        result['quality'] = quality_map.get(score, 'comprehensive')

        logger.info(f"Documentation assessment: quality={result['quality']}")
        return result

    MONITORING_INDICATORS = {
        'Prometheus': ['prometheus', 'micrometer-registry-prometheus', 'prom-client'],
        'Grafana': ['grafana'],
        'Datadog': ['datadog', 'dd-trace', 'ddtrace'],
        'CloudWatch': ['cloudwatch', 'aws-cloudwatch', '@aws-sdk/client-cloudwatch'],
        'OpenTelemetry': ['opentelemetry', 'otel', '@opentelemetry'],
        'New Relic': ['newrelic', 'new-relic'],
        'Splunk': ['splunk'],
        'ELK': ['elasticsearch', 'logstash', 'kibana'],
    }

    LOGGING_FRAMEWORKS = [
        'log4j', 'logback', 'slf4j', 'serilog', 'nlog', 'log4net',
        'winston', 'bunyan', 'pino', 'morgan',
        'logging',  # Python stdlib
    ]

    TRACING_INDICATORS = [
        'opentelemetry', 'otel', 'jaeger', 'zipkin', 'x-ray', 'xray',
        'dd-trace', 'ddtrace', 'newrelic',
    ]

    def _detect_monitoring(self, repo_path: str, dependencies: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Detect monitoring and observability setup.

        Returns:
            { 'has_monitoring': bool, 'tools': [...], 'has_logging': bool,
              'has_tracing': bool, 'maturity': str }
        """
        root = Path(repo_path)
        result = {
            'has_monitoring': False,
            'tools': [],
            'has_logging': False,
            'has_tracing': False,
            'maturity': 'none',
        }

        # Build a searchable string from dependency names
        dep_names_lower = set()
        for dep in dependencies:
            name = (dep.get('name') or dep.get('package_name') or '').lower()
            dep_names_lower.add(name)
            if ':' in name:
                dep_names_lower.add(name.split(':')[-1])

        # Also scan config files for monitoring references
        config_content = ''
        for cfg_name in ['docker-compose.yml', 'docker-compose.yaml',
                         'application.yml', 'application.yaml', 'application.properties']:
            cfg_path = root / cfg_name
            if cfg_path.exists():
                try:
                    config_content += cfg_path.read_text(errors='ignore').lower()
                except Exception:
                    pass
        # Check src/main/resources for Spring apps
        for res_dir in ['src/main/resources', 'config']:
            res_path = root / res_dir
            if res_path.is_dir():
                for f in res_path.iterdir():
                    if f.is_file() and f.suffix in ('.yml', '.yaml', '.properties', '.json'):
                        try:
                            config_content += f.read_text(errors='ignore').lower()
                        except Exception:
                            pass

        searchable = ' '.join(dep_names_lower) + ' ' + config_content

        # Detect monitoring tools
        detected_tools = []
        for tool_name, keywords in self.MONITORING_INDICATORS.items():
            for kw in keywords:
                if kw in searchable:
                    detected_tools.append(tool_name)
                    break
        result['tools'] = detected_tools
        result['has_monitoring'] = len(detected_tools) > 0

        # Detect logging
        for lf in self.LOGGING_FRAMEWORKS:
            if lf in searchable:
                result['has_logging'] = True
                break

        # Detect tracing
        for ti in self.TRACING_INDICATORS:
            if ti in searchable:
                result['has_tracing'] = True
                break

        # Determine maturity
        score = 0
        if result['has_monitoring']:
            score += 2
        if result['has_logging']:
            score += 1
        if result['has_tracing']:
            score += 1

        maturity_map = {0: 'none', 1: 'basic', 2: 'basic', 3: 'good', 4: 'comprehensive'}
        result['maturity'] = maturity_map.get(score, 'comprehensive')

        logger.info(f"Monitoring detection: tools={detected_tools}, maturity={result['maturity']}")
        return result

    # -------------------------------------------------------------------------
    # External integration detection — upstream/downstream systems
    # -------------------------------------------------------------------------

    # Config files to scan for connection strings and endpoints
    CONFIG_FILE_PATTERNS = [
        'application.properties', 'application.yml', 'application.yaml',
        'application-*.properties', 'application-*.yml',
        '.env', '.env.*', 'config.json', 'config.yaml', 'config.yml',
        'settings.py', 'settings/*.py', 'appsettings.json', 'appsettings.*.json',
        'database.yml', 'database.yaml',
    ]

    # Patterns that indicate an external system connection (regex → service type)
    INTEGRATION_PATTERNS = {
        # Databases
        r'jdbc:[a-z]+://': 'Database (JDBC)',
        r'mongodb(\+srv)?://': 'Database (MongoDB)',
        r'postgres(ql)?://': 'Database (PostgreSQL)',
        r'mysql://': 'Database (MySQL)',
        r'sqlserver://': 'Database (SQL Server)',
        r'oracle://|thin:@': 'Database (Oracle)',
        r'redis://|REDIS_URL|REDIS_HOST': 'Cache (Redis)',
        r'memcached://|MEMCACHE': 'Cache (Memcached)',
        r'elasticsearch|ELASTIC_URL|OPENSEARCH': 'Search (Elasticsearch/OpenSearch)',
        # Message queues
        r'amqp://|RABBITMQ_URL|RABBIT_HOST': 'Message Queue (RabbitMQ)',
        r'kafka\.bootstrap|KAFKA_BROKER|bootstrap\.servers': 'Message Queue (Kafka)',
        r'sqs\.(us|eu|ap|sa|ca|me|af)-|SQS_QUEUE_URL|\.sqs\.': 'Message Queue (SQS)',
        r'sns\.(us|eu|ap|sa|ca|me|af)-|SNS_TOPIC_ARN|\.sns\.': 'Notification (SNS)',
        # Cloud services
        r's3\.(us|eu|ap|sa|ca|me|af)-|S3_BUCKET|\.s3\.amazonaws': 'Storage (S3)',
        r'dynamodb\.(us|eu|ap|sa|ca|me|af)-|DYNAMODB_TABLE': 'Database (DynamoDB)',
        r'lambda\.(us|eu|ap|sa|ca|me|af)-|LAMBDA_FUNCTION': 'Compute (Lambda)',
        r'secretsmanager|SECRETS_MANAGER': 'Secrets (Secrets Manager)',  # pragma: allowlist secret  # nosec — regex pattern, not a credential
        # External APIs
        r'https?://[a-z0-9.-]+\.(com|org|net|io|dev|cloud)/api': 'External API',
        r'grpc://|GRPC_HOST|GRPC_PORT': 'External API (gRPC)',
        # SMTP
        r'smtp://|SMTP_HOST|MAIL_SERVER': 'Email (SMTP)',
        # LDAP
        r'ldap(s)?://|LDAP_URL': 'Directory (LDAP)',
    }

    # Source code patterns for programmatic service usage
    SOURCE_CODE_INTEGRATION_PATTERNS = {
        # AWS SDK service clients
        r'boto3\.client\(["\'](\w+)["\']\)': 'AWS',
        r'boto3\.resource\(["\'](\w+)["\']\)': 'AWS',
        r'@aws-sdk/client-(\w+)': 'AWS',
        r'AmazonS3Client|AmazonDynamoDB|AmazonSQS|AmazonSNS': 'AWS',
        # Database connections in code
        r'DriverManager\.getConnection|DataSource|createConnection': 'Database',
        r'create_engine\(|sessionmaker|MongoClient\(': 'Database',
        r'createPool\(|createConnection\(|knex\(': 'Database',
        # HTTP clients calling external services
        r'RestTemplate|WebClient\.create|FeignClient': 'External API (Java)',
        r'requests\.(get|post|put|delete)\(|httpx\.(get|post)': 'External API (Python)',
        r'axios\.(get|post)|fetch\(["\']https?://': 'External API (JS)',
    }

    def _detect_external_integrations(self, repo_path: str, dependencies: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Detect actual external system integration points (upstream/downstream).

        Scans config files and source code for connection strings, endpoints,
        and service references. Returns deduplicated count of distinct external
        systems, not just dependency libraries.

        Returns:
            {
                'integration_count': int,
                'integrations': [{'type': str, 'source': str, 'detail': str}, ...],
                'by_type': {'Database': 2, 'Message Queue': 1, ...}
            }
        """
        root = Path(repo_path)
        integrations = []  # list of (type, source_file, detail)
        seen = set()  # dedup key: (type_category, detail_normalized)

        def _add(service_type: str, source: str, detail: str):
            # Normalize the dedup key — strip protocol, lowercase
            category = service_type.split('(')[0].strip()
            detail_norm = re.sub(r'https?://', '', detail).strip().lower()[:80]
            key = (category, detail_norm)
            if key not in seen:
                seen.add(key)
                integrations.append({
                    'type': service_type,
                    'source': str(source),
                    'detail': detail[:120],
                })

        # 1. Scan config files for connection strings
        config_files = []
        for pattern in self.CONFIG_FILE_PATTERNS:
            if '*' in pattern:
                config_files.extend(root.rglob(pattern))
            else:
                config_files.extend(self._find_files_by_name(root, pattern))

        for cfg_file in config_files:
            try:
                content = cfg_file.read_text(errors='ignore')
                rel_path = str(cfg_file.relative_to(root))
                for regex, svc_type in self.INTEGRATION_PATTERNS.items():
                    for match in re.finditer(regex, content, re.IGNORECASE):
                        _add(svc_type, rel_path, match.group(0))
            except Exception:
                continue

        # 2. Scan source code for programmatic service usage
        source_extensions = {'.java', '.py', '.ts', '.tsx', '.js', '.jsx', '.cs', '.go'}
        for src_file in root.rglob('*'):
            if src_file.suffix not in source_extensions:
                continue
            if any(skip in src_file.parts for skip in self.SKIP_DIRECTORIES):
                continue
            try:
                content = src_file.read_text(errors='ignore')
                rel_path = str(src_file.relative_to(root))
                for regex, svc_type in self.SOURCE_CODE_INTEGRATION_PATTERNS.items():
                    for match in re.finditer(regex, content):
                        detail = match.group(0)
                        # For boto3 patterns, extract the service name
                        if 'boto3' in regex and match.lastindex:
                            aws_svc = match.group(1)
                            svc_type = f'AWS ({aws_svc})'
                            detail = aws_svc
                        _add(svc_type, rel_path, detail)
            except Exception:
                continue

        # 3. Also count integration-type dependencies that weren't caught above
        # (e.g., having kafka-clients but no config file with bootstrap.servers)
        integration_dep_keywords = {
            'kafka': 'Message Queue (Kafka)',
            'rabbitmq': 'Message Queue (RabbitMQ)',
            'amqp': 'Message Queue (RabbitMQ)',
            'redis': 'Cache (Redis)',
            'memcache': 'Cache (Memcached)',
            'elasticsearch': 'Search (Elasticsearch)',
            'opensearch': 'Search (OpenSearch)',
            'mongodb': 'Database (MongoDB)',
            'mysql': 'Database (MySQL)',
            'postgres': 'Database (PostgreSQL)',
            'oracle': 'Database (Oracle)',
            'sqlserver': 'Database (SQL Server)',
            'dynamodb': 'Database (DynamoDB)',
        }
        for dep in dependencies:
            dep_name = (dep.get('name') or dep.get('artifact_id') or '').lower()
            for kw, svc_type in integration_dep_keywords.items():
                if kw in dep_name:
                    _add(svc_type, 'dependency', dep_name)
                    break

        # Build by_type summary
        by_type: Dict[str, int] = {}
        for intg in integrations:
            category = intg['type'].split('(')[0].strip()
            by_type[category] = by_type.get(category, 0) + 1

        logger.info(f"External integrations detected: {len(integrations)} "
                     f"({by_type})")

        return {
            'integration_count': len(integrations),
            'integrations': integrations,
            'by_type': by_type,
        }

    # -------------------------------------------------------------------------
    # Repository analysis orchestrator — Task 1.8
    # -------------------------------------------------------------------------

    def analyze_repository(self, repo_url: str) -> Dict[str, Any]:
        """
        Full repository analysis orchestrator.

        Workflow:
        1. Clone repo
        2. Detect dependency files
        3. Parse dependencies
        4. Classify + normalize
        5. Detect language version
        6. Detect application type
        7. Analyze testing maturity
        8. Detect CI/CD maturity
        9. Assess documentation quality
        10. Detect monitoring maturity
        11. Cleanup cloned repo

        Individual sub-method failures are caught and defaulted so the
        overall analysis always returns a result.
        """
        import time
        start = time.time()
        local_path = None

        result = {
            'success': False,
            'repository_url': repo_url,
            'dependencies': {'count': 0, 'items': [], 'integration_count': 0, 'category_summary': {}},
            'language_version': {'language': 'Unknown', 'current_version': None, 'major_version': None},
            'application_type': {'type': 'Unknown', 'framework': 'Unknown', 'label': 'Unknown'},
            'testing': {'has_tests': False, 'frameworks': [], 'has_unit': False,
                        'has_integration': False, 'has_e2e': False,
                        'estimated_coverage': 0, 'maturity': 'No Tests'},
            'cicd': {'has_pipeline': False, 'tool': 'None', 'stages': [], 'maturity': 'none'},
            'documentation': {'has_readme': False, 'has_api_docs': False,
                              'has_architecture': False, 'quality': 'none'},
            'monitoring': {'has_monitoring': False, 'tools': [], 'has_logging': False,
                           'has_tracing': False, 'maturity': 'none'},
            'warnings': [],
            'analysis_time_seconds': 0,
        }

        try:
            # 1. Clone
            logger.info(f"[analyze_repository] Starting analysis for: {repo_url}")
            clone_result = self._clone_repository(repo_url)
            if not clone_result.get('success'):
                clone_error = clone_result.get('error', 'unknown')
                logger.error(
                    f"[analyze_repository] Clone FAILED for {repo_url} | error={clone_error}"
                )
                result['warnings'].append(f"Clone failed: {clone_error}")
                result['analysis_time_seconds'] = round(time.time() - start, 2)
                return result

            local_path = clone_result['local_path']
            logger.info(
                f"[analyze_repository] Clone OK for {repo_url} | "
                f"path={local_path} | size={clone_result.get('size_bytes', 0) / (1024**2):.1f} MB"
            )

            # 2. Detect dependency files
            try:
                detected = self._detect_dependency_files(local_path)
            except Exception as e:
                logger.error(f"Dependency file detection failed: {e}")
                detected = {'success': False, 'files': [], 'by_ecosystem': {}}
                result['warnings'].append(f"Dependency detection failed: {e}")

            # 3. Parse dependencies
            raw_deps = []
            try:
                if detected.get('success'):
                    raw_deps = self._parse_dependencies(detected, repo_url)
            except Exception as e:
                logger.error(f"Dependency parsing failed: {e}")
                result['warnings'].append(f"Dependency parsing failed: {e}")

            # 4. Classify + normalize
            try:
                classified = self._classify_and_normalize(raw_deps)
                result['dependencies'] = {
                    'count': classified['total_count'],
                    'items': classified['dependencies'],
                    'integration_count': classified['integration_count'],
                    'category_summary': classified['category_summary'],
                }
            except Exception as e:
                logger.error(f"Classification failed: {e}")
                result['warnings'].append(f"Classification failed: {e}")

            # 4b. Detect external integrations (upstream/downstream systems)
            try:
                deps_for_intg = result['dependencies'].get('items', raw_deps)
                ext_integrations = self._detect_external_integrations(local_path, deps_for_intg)
                result['dependencies']['integration_count'] = ext_integrations['integration_count']
                result['dependencies']['integrations'] = ext_integrations['integrations']
                result['dependencies']['integrations_by_type'] = ext_integrations['by_type']
            except Exception as e:
                logger.error(f"External integration detection failed: {e}")
                result['warnings'].append(f"External integration detection failed: {e}")

            # 5. Language version
            try:
                result['language_version'] = self._detect_language_version(local_path)
            except Exception as e:
                logger.error(f"Language version detection failed: {e}")
                result['warnings'].append(f"Language version detection failed: {e}")

            # 6. Application type
            try:
                deps_for_type = result['dependencies'].get('items', raw_deps)
                result['application_type'] = self._detect_application_type(local_path, deps_for_type)
            except Exception as e:
                logger.error(f"Application type detection failed: {e}")
                result['warnings'].append(f"Application type detection failed: {e}")

            # 7. Testing maturity
            try:
                result['testing'] = self._analyze_testing(local_path)
            except Exception as e:
                logger.error(f"Testing analysis failed: {e}")
                result['warnings'].append(f"Testing analysis failed: {e}")

            # 8. CI/CD
            try:
                result['cicd'] = self._detect_cicd(local_path)
            except Exception as e:
                logger.error(f"CI/CD detection failed: {e}")
                result['warnings'].append(f"CI/CD detection failed: {e}")

            # 9. Documentation
            try:
                result['documentation'] = self._assess_documentation(local_path)
            except Exception as e:
                logger.error(f"Documentation assessment failed: {e}")
                result['warnings'].append(f"Documentation assessment failed: {e}")

            # 10. Monitoring
            try:
                monitoring_deps = result['dependencies'].get('items', raw_deps)
                result['monitoring'] = self._detect_monitoring(local_path, monitoring_deps)
            except Exception as e:
                logger.error(f"Monitoring detection failed: {e}")
                result['warnings'].append(f"Monitoring detection failed: {e}")

            result['success'] = True

        except Exception as e:
            logger.error(f"Repository analysis failed: {e}", exc_info=True)
            result['warnings'].append(f"Analysis failed: {e}")

        finally:
            # 11. Always cleanup
            if local_path:
                self._cleanup_repository(local_path)

            elapsed = round(time.time() - start, 2)
            result['analysis_time_seconds'] = elapsed
            logger.info(f"Repository analysis completed in {elapsed}s "
                         f"(deps={result['dependencies']['count']}, "
                         f"warnings={len(result['warnings'])})")

        return result
