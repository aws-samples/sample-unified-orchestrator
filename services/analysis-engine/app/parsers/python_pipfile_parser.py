"""
Python Pipfile Parser

Parses Pipfile and Pipfile.lock files for Pipenv projects.
Prioritizes lock file for exact versions.
"""

import logging
import json
from typing import Dict, List, Any, Optional
from pathlib import Path

try:
    import toml
    TOML_AVAILABLE = True
except ImportError:
    TOML_AVAILABLE = False
    logging.warning("toml library not installed. Pipfile parsing will not be available.")

logger = logging.getLogger(__name__)


class PipfileParser:
    """
    Parser for Pipfile and Pipfile.lock files

    Features:
    - Parse Pipfile (TOML format)
    - Parse Pipfile.lock (JSON format)
    - Prioritize Pipfile.lock over Pipfile for exact versions
    - Extract from [packages] and [dev-packages]
    - Handle wildcard versions (*)
    """

    def __init__(self):
        """Initialize Pipfile Parser"""
        if not TOML_AVAILABLE:
            raise ImportError("toml library is required for Pipfile parsing. Install with: pip install toml")
        logger.info("Pipfile Parser initialized")

    def parse_pipfile(self, pipfile_path: str) -> Dict[str, Any]:
        """
        Parse a Pipfile or Pipfile.lock file

        Args:
            pipfile_path: Path to Pipfile or Pipfile.lock file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            pipfile = Path(pipfile_path)

            if not pipfile.exists():
                return {
                    "success": False,
                    "error": f"Pipfile not found: {pipfile_path}"
                }

            logger.info(f"Parsing Pipfile: {pipfile_path}")

            # Check if it's a lock file
            is_lock_file = pipfile.name == 'Pipfile.lock'

            if is_lock_file:
                result = self._parse_lock_file(pipfile)
            else:
                result = self._parse_pipfile_toml(pipfile)

                # Check for lock file in same directory
                lock_file = pipfile.parent / 'Pipfile.lock'
                if lock_file.exists():
                    logger.info(f"Found Pipfile.lock, using it for exact versions")
                    lock_result = self._parse_lock_file(lock_file)
                    if lock_result['success']:
                        # Merge with lock file taking precedence
                        result = self._merge_with_lock(result, lock_result)

            return result

        except Exception as e:
            logger.error(f"Failed to parse Pipfile {pipfile_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse Pipfile: {str(e)}"
            }

    def _parse_pipfile_toml(self, pipfile: Path) -> Dict[str, Any]:
        """Parse Pipfile (TOML format)"""
        try:
            content = toml.load(pipfile)

            dependencies = []

            # Parse [packages]
            packages = content.get('packages', {})
            for package_name, version_spec in packages.items():
                dep = self._parse_package_spec(package_name, version_spec, is_dev=False)
                dependencies.append(dep)

            # Parse [dev-packages]
            dev_packages = content.get('dev-packages', {})
            for package_name, version_spec in dev_packages.items():
                dep = self._parse_package_spec(package_name, version_spec, is_dev=True)
                dependencies.append(dep)

            # Extract metadata
            metadata = {
                'python_version': content.get('requires', {}).get('python_version'),
                'source': content.get('source', [])
            }

            logger.info(f"Extracted {len(dependencies)} dependencies from Pipfile")

            return {
                "success": True,
                "file_path": str(pipfile),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies),
                "source": "Pipfile"
            }

        except Exception as e:
            logger.error(f"Failed to parse Pipfile TOML: {e}")
            return {
                "success": False,
                "error": f"Failed to parse Pipfile TOML: {str(e)}"
            }

    def _parse_lock_file(self, lock_file: Path) -> Dict[str, Any]:
        """Parse Pipfile.lock (JSON format)"""
        try:
            with open(lock_file, 'r') as f:
                content = json.load(f)

            dependencies = []

            # Parse default packages
            default_packages = content.get('default', {})
            for package_name, package_info in default_packages.items():
                dep = self._parse_lock_package(package_name, package_info, is_dev=False)
                dependencies.append(dep)

            # Parse develop packages
            develop_packages = content.get('develop', {})
            for package_name, package_info in develop_packages.items():
                dep = self._parse_lock_package(package_name, package_info, is_dev=True)
                dependencies.append(dep)

            # Extract metadata
            metadata = {
                'python_version': content.get('_meta', {}).get('requires', {}).get('python_version'),
                'hash': content.get('_meta', {}).get('hash', {}).get('sha256')
            }

            logger.info(f"Extracted {len(dependencies)} dependencies from Pipfile.lock")

            return {
                "success": True,
                "file_path": str(lock_file),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies),
                "source": "Pipfile.lock"
            }

        except Exception as e:
            logger.error(f"Failed to parse Pipfile.lock: {e}")
            return {
                "success": False,
                "error": f"Failed to parse Pipfile.lock: {str(e)}"
            }

    def _parse_package_spec(self, package_name: str, version_spec: Any, is_dev: bool) -> Dict[str, Any]:
        """Parse package specification from Pipfile"""
        # version_spec can be a string like "*" or ">=2.0" or a dict with version, extras, etc.

        if isinstance(version_spec, str):
            version = version_spec if version_spec != '*' else None
            needs_lookup = version_spec == '*'
        elif isinstance(version_spec, dict):
            version = version_spec.get('version', '*')
            if version == '*':
                version = None
                needs_lookup = True
            else:
                needs_lookup = False
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
            'package_manager': 'Pipenv',
            'name': package_name,
            'full_name': f"{package_name}=={version}" if version else package_name
        }

    def _parse_lock_package(self, package_name: str, package_info: Dict, is_dev: bool) -> Dict[str, Any]:
        """Parse package from Pipfile.lock"""
        version = package_info.get('version', '').lstrip('=')

        return {
            'package_name': package_name,
            'version': version,
            'version_spec': package_info.get('version', ''),
            'is_dev': is_dev,
            'type': 'Development' if is_dev else 'Runtime',
            'needs_lookup': False,
            'hashes': package_info.get('hashes', []),
            'ecosystem': 'Python',
            'package_manager': 'Pipenv',
            'name': package_name,
            'full_name': f"{package_name}=={version}" if version else package_name
        }

    def _merge_with_lock(self, pipfile_result: Dict, lock_result: Dict) -> Dict:
        """Merge Pipfile result with Pipfile.lock (lock takes precedence)"""
        # Use lock file dependencies as they have exact versions
        return {
            "success": True,
            "file_path": pipfile_result['file_path'],
            "dependencies": lock_result['dependencies'],
            "metadata": {**pipfile_result.get('metadata', {}), **lock_result.get('metadata', {})},
            "total_dependencies": len(lock_result['dependencies']),
            "source": "Pipfile.lock (prioritized over Pipfile)"
        }
