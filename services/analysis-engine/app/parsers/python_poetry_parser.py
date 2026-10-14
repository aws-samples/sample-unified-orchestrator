"""
Python Poetry Parser

Parses pyproject.toml and poetry.lock files for Poetry projects.
Prioritizes lock file for exact versions.
"""

import logging
from typing import Dict, List, Any, Optional
from pathlib import Path

try:
    import toml
    TOML_AVAILABLE = True
except ImportError:
    TOML_AVAILABLE = False
    logging.warning("toml library not installed. Poetry parsing will not be available.")

logger = logging.getLogger(__name__)


class PoetryParser:
    """
    Parser for Poetry pyproject.toml and poetry.lock files

    Features:
    - Parse pyproject.toml (TOML format)
    - Parse poetry.lock for exact versions
    - Prioritize poetry.lock over pyproject.toml
    - Handle caret (^) and tilde (~) constraints
    - Extract from [tool.poetry.dependencies]
    """

    def __init__(self):
        """Initialize Poetry Parser"""
        if not TOML_AVAILABLE:
            raise ImportError("toml library is required for Poetry parsing. Install with: pip install toml")
        logger.info("Poetry Parser initialized")

    def parse_poetry(self, poetry_path: str) -> Dict[str, Any]:
        """
        Parse a pyproject.toml or poetry.lock file

        Args:
            poetry_path: Path to pyproject.toml or poetry.lock file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            poetry_file = Path(poetry_path)

            if not poetry_file.exists():
                return {
                    "success": False,
                    "error": f"Poetry file not found: {poetry_path}"
                }

            logger.info(f"Parsing Poetry file: {poetry_path}")

            # Check if it's a lock file
            is_lock_file = poetry_file.name == 'poetry.lock'

            if is_lock_file:
                result = self._parse_lock_file(poetry_file)
            else:
                result = self._parse_pyproject_toml(poetry_file)

                # Check for lock file in same directory
                lock_file = poetry_file.parent / 'poetry.lock'
                if lock_file.exists():
                    logger.info(f"Found poetry.lock, using it for exact versions")
                    lock_result = self._parse_lock_file(lock_file)
                    if lock_result['success']:
                        # Merge with lock file taking precedence
                        result = self._merge_with_lock(result, lock_result)

            return result

        except Exception as e:
            logger.error(f"Failed to parse Poetry file {poetry_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse Poetry file: {str(e)}"
            }

    def _parse_pyproject_toml(self, pyproject_file: Path) -> Dict[str, Any]:
        """Parse pyproject.toml file"""
        try:
            content = toml.load(pyproject_file)

            # Check if it's a Poetry project
            if 'tool' not in content or 'poetry' not in content['tool']:
                return {
                    "success": False,
                    "error": "Not a Poetry project (missing [tool.poetry] section)"
                }

            poetry_config = content['tool']['poetry']

            dependencies = []

            # Parse dependencies
            deps = poetry_config.get('dependencies', {})
            for package_name, version_spec in deps.items():
                # Skip python itself
                if package_name.lower() == 'python':
                    continue

                dep = self._parse_dependency_spec(package_name, version_spec, is_dev=False)
                dependencies.append(dep)

            # Parse dev dependencies
            dev_deps = poetry_config.get('dev-dependencies', {})
            for package_name, version_spec in dev_deps.items():
                dep = self._parse_dependency_spec(package_name, version_spec, is_dev=True)
                dependencies.append(dep)

            # Also check group dependencies (Poetry 1.2+)
            groups = poetry_config.get('group', {})
            for group_name, group_config in groups.items():
                group_deps = group_config.get('dependencies', {})
                is_dev = group_name in ['dev', 'test']
                for package_name, version_spec in group_deps.items():
                    dep = self._parse_dependency_spec(package_name, version_spec, is_dev=is_dev)
                    dep['group'] = group_name
                    dependencies.append(dep)

            # Extract metadata
            metadata = {
                'name': poetry_config.get('name'),
                'version': poetry_config.get('version'),
                'description': poetry_config.get('description'),
                'python_version': deps.get('python', '')
            }

            logger.info(f"Extracted {len(dependencies)} dependencies from pyproject.toml")

            return {
                "success": True,
                "file_path": str(pyproject_file),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies),
                "source": "pyproject.toml"
            }

        except Exception as e:
            logger.error(f"Failed to parse pyproject.toml: {e}")
            return {
                "success": False,
                "error": f"Failed to parse pyproject.toml: {str(e)}"
            }

    def _parse_lock_file(self, lock_file: Path) -> Dict[str, Any]:
        """Parse poetry.lock file"""
        try:
            content = toml.load(lock_file)

            dependencies = []

            # Parse [[package]] sections
            packages = content.get('package', [])
            for package_info in packages:
                dep = self._parse_lock_package(package_info)
                dependencies.append(dep)

            # Extract metadata
            metadata = content.get('metadata', {})

            logger.info(f"Extracted {len(dependencies)} dependencies from poetry.lock")

            return {
                "success": True,
                "file_path": str(lock_file),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies),
                "source": "poetry.lock"
            }

        except Exception as e:
            logger.error(f"Failed to parse poetry.lock: {e}")
            return {
                "success": False,
                "error": f"Failed to parse poetry.lock: {str(e)}"
            }

    def _parse_dependency_spec(self, package_name: str, version_spec: Any, is_dev: bool) -> Dict[str, Any]:
        """Parse dependency specification from pyproject.toml"""
        # version_spec can be a string like "^1.2.3" or a dict with version, extras, etc.

        if isinstance(version_spec, str):
            version = self._resolve_version_constraint(version_spec)
            needs_lookup = version is None
        elif isinstance(version_spec, dict):
            version_str = version_spec.get('version', '')
            version = self._resolve_version_constraint(version_str)
            needs_lookup = version is None
        else:
            version = None
            needs_lookup = True

        return {
            'package_name': package_name,
            'version': version,
            'version_spec': str(version_spec),
            'is_dev': is_dev,
            'type': 'Development' if is_dev else 'Runtime',
            'needs_lookup': needs_lookup,
            'ecosystem': 'Python',
            'package_manager': 'Poetry',
            'name': package_name,
            'full_name': f"{package_name}=={version}" if version else package_name
        }

    def _parse_lock_package(self, package_info: Dict) -> Dict[str, Any]:
        """Parse package from poetry.lock"""
        package_name = package_info.get('name', '')
        version = package_info.get('version', '')
        category = package_info.get('category', 'main')
        is_dev = category in ['dev', 'test']

        return {
            'package_name': package_name,
            'version': version,
            'version_spec': version,
            'is_dev': is_dev,
            'type': 'Development' if is_dev else 'Runtime',
            'needs_lookup': False,
            'category': category,
            'description': package_info.get('description', ''),
            'ecosystem': 'Python',
            'package_manager': 'Poetry',
            'name': package_name,
            'full_name': f"{package_name}=={version}" if version else package_name
        }

    def _resolve_version_constraint(self, version_spec: str) -> Optional[str]:
        """Resolve Poetry version constraints to a specific version"""
        if not version_spec:
            return None

        # Handle caret (^) - compatible release
        # ^1.2.3 means >=1.2.3,<2.0.0
        if version_spec.startswith('^'):
            return version_spec[1:]  # Use minimum version

        # Handle tilde (~) - approximately equivalent
        # ~1.2.3 means >=1.2.3,<1.3.0
        if version_spec.startswith('~'):
            return version_spec[1:]  # Use minimum version

        # Handle exact version
        if version_spec.startswith('=='):
            return version_spec[2:]

        # Handle >=
        if version_spec.startswith('>='):
            return version_spec[2:]

        # Handle wildcard
        if version_spec == '*':
            return None

        # If it's just a version number, return it
        if version_spec[0].isdigit():
            return version_spec

        return None

    def _merge_with_lock(self, pyproject_result: Dict, lock_result: Dict) -> Dict:
        """Merge pyproject.toml result with poetry.lock (lock takes precedence)"""
        # Use lock file dependencies as they have exact versions
        return {
            "success": True,
            "file_path": pyproject_result['file_path'],
            "dependencies": lock_result['dependencies'],
            "metadata": {**pyproject_result.get('metadata', {}), **lock_result.get('metadata', {})},
            "total_dependencies": len(lock_result['dependencies']),
            "source": "poetry.lock (prioritized over pyproject.toml)"
        }
