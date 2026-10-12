"""
.NET packages.config Parser

Parses packages.config files for legacy .NET Framework projects.
"""

import logging
from typing import Dict, List, Any, Optional
from pathlib import Path

try:
    import defusedxml.ElementTree as ET
except ImportError:
    ET = None

logger = logging.getLogger(__name__)


class PackagesConfigParser:
    """
    Parser for packages.config files

    Features:
    - Extract <package> elements
    - Capture id and version attributes
    - Extract targetFramework
    - Support legacy .NET Framework format
    """

    def __init__(self):
        """Initialize packages.config Parser"""
        if ET is None:
            raise ImportError("defusedxml is required for packages.config parsing")
        logger.info("packages.config Parser initialized")

    def parse_packages_config(self, packages_path: str) -> Dict[str, Any]:
        """
        Parse a packages.config file

        Args:
            packages_path: Path to packages.config file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            packages_file = Path(packages_path)

            if not packages_file.exists():
                return {
                    "success": False,
                    "error": f"packages.config file not found: {packages_path}"
                }

            logger.info(f"Parsing packages.config: {packages_path}")

            # Parse XML
            tree = ET.parse(packages_path)
            root = tree.getroot()

            # Extract dependencies
            dependencies = self._extract_packages(root)

            # Extract metadata
            metadata = {
                'file_type': 'packages.config',
                'format': 'Legacy .NET Framework'
            }

            logger.info(f"Extracted {len(dependencies)} dependencies from {packages_path}")

            return {
                "success": True,
                "file_path": str(packages_path),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies)
            }

        except ET.ParseError as e:
            logger.error(f"XML parsing error in {packages_path}: {e}")
            return {
                "success": False,
                "error": f"XML parsing error: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Failed to parse packages.config {packages_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse packages.config: {str(e)}"
            }

    def _extract_packages(self, root) -> List[Dict[str, Any]]:
        """Extract package elements"""
        dependencies = []

        # Find all package elements
        for package in root.findall('package'):
            # Get id attribute (package name)
            package_id = package.get('id')
            if not package_id:
                continue

            # Get version attribute
            version = package.get('version')

            # Get targetFramework attribute (optional)
            target_framework = package.get('targetFramework')

            dependency = {
                'package_name': package_id,
                'version': version,
                'target_framework': target_framework,
                'ecosystem': '.NET',
                'package_manager': 'NuGet',
                'name': package_id,
                'full_name': f"{package_id}:{version}" if version else package_id
            }

            dependencies.append(dependency)

        return dependencies
