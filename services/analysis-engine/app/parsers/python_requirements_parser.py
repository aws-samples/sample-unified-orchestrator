"""
Python requirements.txt Parser

Parses requirements.txt files to extract Python package dependencies.
Handles version operators and ranges.
"""

import logging
import re
from typing import Dict, List, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class RequirementsParser:
    """
    Parser for Python requirements.txt files

    Features:
    - Parse version operators (==, >=, <=, >, <, ~=, !=)
    - Handle version ranges
    - Skip comments and empty lines
    - Handle editable installs (-e)
    - Flag missing versions for PyPI lookup
    """

    # Version operator patterns
    VERSION_OPERATORS = ['==', '>=', '<=', '>', '<', '~=', '!=']

    def __init__(self):
        """Initialize Requirements Parser"""
        logger.info("Requirements Parser initialized")

    def parse_requirements(self, requirements_path: str) -> Dict[str, Any]:
        """
        Parse a requirements.txt file

        Args:
            requirements_path: Path to requirements.txt file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            req_file = Path(requirements_path)

            if not req_file.exists():
                return {
                    "success": False,
                    "error": f"Requirements file not found: {requirements_path}"
                }

            logger.info(f"Parsing requirements.txt: {requirements_path}")

            # Read file content
            content = req_file.read_text(encoding='utf-8')
            lines = content.splitlines()

            # Parse dependencies
            dependencies = []
            skipped_lines = []

            for line_num, line in enumerate(lines, 1):
                line = line.strip()

                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue

                # Handle editable installs
                if line.startswith('-e'):
                    logger.info(f"Skipping editable install: {line}")
                    skipped_lines.append({'line': line, 'reason': 'editable install'})
                    continue

                # Handle requirement files
                if line.startswith('-r'):
                    logger.info(f"Skipping nested requirement file: {line}")
                    skipped_lines.append({'line': line, 'reason': 'nested requirement file'})
                    continue

                # Parse dependency
                dep = self._parse_dependency_line(line, line_num)
                if dep:
                    dependencies.append(dep)
                else:
                    skipped_lines.append({'line': line, 'reason': 'parse failed'})

            logger.info(f"Extracted {len(dependencies)} dependencies from {requirements_path}")

            return {
                "success": True,
                "file_path": str(requirements_path),
                "dependencies": dependencies,
                "total_dependencies": len(dependencies),
                "skipped_lines": skipped_lines
            }

        except Exception as e:
            logger.error(f"Failed to parse requirements.txt {requirements_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse requirements.txt: {str(e)}"
            }

    def _parse_dependency_line(self, line: str, line_num: int) -> Optional[Dict[str, Any]]:
        """Parse a single dependency line"""
        try:
            # Remove inline comments
            if '#' in line:
                line = line.split('#')[0].strip()

            # Pattern: package_name[extras]operator version
            # Examples: requests==2.28.0, Django>=3.2,<4.0, numpy~=1.21.0

            # Extract package name (may include extras like package[extra])
            package_pattern = r'^([a-zA-Z0-9_\-\.]+)(\[[^\]]+\])?'
            match = re.match(package_pattern, line)

            if not match:
                logger.warning(f"Could not parse line {line_num}: {line}")
                return None

            package_name = match.group(1)
            extras = match.group(2) or ''

            # Extract version specifiers
            version_part = line[len(match.group(0)):].strip()

            if not version_part:
                # No version specified
                return {
                    'package_name': package_name,
                    'version': None,
                    'version_spec': None,
                    'operator': None,
                    'extras': extras.strip('[]') if extras else None,
                    'needs_lookup': True,
                    'ecosystem': 'Python',
                    'package_manager': 'pip',
                    'name': package_name,
                    'full_name': package_name
                }

            # Parse version specifiers
            version_specs = self._parse_version_specifiers(version_part)

            # Determine primary version (use minimum for ranges)
            primary_version = self._get_primary_version(version_specs)

            return {
                'package_name': package_name,
                'version': primary_version,
                'version_spec': version_part,
                'version_specs': version_specs,
                'operator': version_specs[0]['operator'] if version_specs else None,
                'extras': extras.strip('[]') if extras else None,
                'needs_lookup': primary_version is None,
                'ecosystem': 'Python',
                'package_manager': 'pip',
                'name': package_name,
                'full_name': f"{package_name}=={primary_version}" if primary_version else package_name
            }

        except Exception as e:
            logger.error(f"Error parsing line {line_num}: {line} - {e}")
            return None

    def _parse_version_specifiers(self, version_part: str) -> List[Dict[str, str]]:
        """Parse version specifiers like >=2.28.0,<3.0.0"""
        specs = []

        # Split by comma for multiple specifiers
        parts = [p.strip() for p in version_part.split(',')]

        for part in parts:
            # Find operator
            operator = None
            for op in self.VERSION_OPERATORS:
                if part.startswith(op):
                    operator = op
                    break

            if operator:
                version = part[len(operator):].strip()
                specs.append({
                    'operator': operator,
                    'version': version
                })
            else:
                # No operator, might be just a version
                logger.warning(f"No operator found in version spec: {part}")

        return specs

    def _get_primary_version(self, version_specs: List[Dict[str, str]]) -> Optional[str]:
        """Get primary version from version specifiers"""
        if not version_specs:
            return None

        # Priority: == > >= > ~= > others
        for spec in version_specs:
            if spec['operator'] == '==':
                return spec['version']

        for spec in version_specs:
            if spec['operator'] in ['>=', '~=']:
                return spec['version']

        # Return first version as fallback
        return version_specs[0]['version']
