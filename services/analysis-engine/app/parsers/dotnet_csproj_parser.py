"""
.NET .csproj Parser

Parses .NET project files (.csproj) to extract NuGet package dependencies.
Supports both .NET Core/5+ and .NET Framework formats.
"""

import logging
import re
from typing import Dict, List, Any, Optional
from pathlib import Path

try:
    import defusedxml.ElementTree as ET
except ImportError:
    ET = None

logger = logging.getLogger(__name__)


class CsprojParser:
    """
    Parser for .NET .csproj files

    Features:
    - Extract <PackageReference> elements
    - Handle wildcard versions (2.12.*)
    - Handle version ranges ([12.0.0,13.0.0))
    - Extract TargetFramework
    - Support both SDK-style and legacy formats
    """

    def __init__(self):
        """Initialize .csproj Parser"""
        if ET is None:
            raise ImportError("defusedxml is required for .csproj parsing")
        logger.info(".csproj Parser initialized")

    def parse_csproj(self, csproj_path: str) -> Dict[str, Any]:
        """
        Parse a .csproj file

        Args:
            csproj_path: Path to .csproj file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            csproj_file = Path(csproj_path)

            if not csproj_file.exists():
                return {
                    "success": False,
                    "error": f".csproj file not found: {csproj_path}"
                }

            logger.info(f"Parsing .csproj file: {csproj_path}")

            # Parse XML
            tree = ET.parse(csproj_path)
            root = tree.getroot()

            # Extract namespace (may be empty for SDK-style projects)
            namespace = self._extract_namespace(root)

            # Extract dependencies
            dependencies = self._extract_package_references(root, namespace)

            # Extract metadata
            metadata = self._extract_metadata(root, namespace, csproj_file.name)

            logger.info(f"Extracted {len(dependencies)} dependencies from {csproj_path}")

            return {
                "success": True,
                "file_path": str(csproj_path),
                "dependencies": dependencies,
                "metadata": metadata,
                "total_dependencies": len(dependencies)
            }

        except ET.ParseError as e:
            logger.error(f"XML parsing error in {csproj_path}: {e}")
            return {
                "success": False,
                "error": f"XML parsing error: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Failed to parse .csproj {csproj_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse .csproj: {str(e)}"
            }

    def _extract_namespace(self, root) -> str:
        """Extract XML namespace from root element"""
        match = re.match(r'\{(.*)\}', root.tag)
        return match.group(1) if match else ''

    def _extract_package_references(self, root, namespace: str) -> List[Dict[str, Any]]:
        """Extract PackageReference elements"""
        dependencies = []

        # Find all PackageReference elements (can be in ItemGroup)
        if namespace:
            package_refs = root.findall(f'.//{{{namespace}}}PackageReference')
        else:
            package_refs = root.findall('.//PackageReference')

        for pkg_ref in package_refs:
            # Get Include attribute (package name)
            package_name = pkg_ref.get('Include')
            if not package_name:
                continue

            # Get Version attribute or child element
            version = pkg_ref.get('Version')
            if not version:
                # Try to find Version as child element
                if namespace:
                    version_elem = pkg_ref.find(f'{{{namespace}}}Version')
                else:
                    version_elem = pkg_ref.find('Version')

                if version_elem is not None and version_elem.text:
                    version = version_elem.text.strip()

            # Normalize version
            normalized_version = self._normalize_version(version) if version else None

            dependency = {
                'package_name': package_name,
                'version': normalized_version,
                'version_spec': version,
                'ecosystem': '.NET',
                'package_manager': 'NuGet',
                'name': package_name,
                'full_name': f"{package_name}:{normalized_version}" if normalized_version else package_name
            }

            dependencies.append(dependency)

        return dependencies

    def _extract_metadata(self, root, namespace: str, filename: str) -> Dict[str, str]:
        """Extract project metadata"""
        metadata = {
            'project_file': filename
        }

        # Extract TargetFramework or TargetFrameworks
        target_framework = self._get_element_text(root, 'TargetFramework', namespace)
        if target_framework:
            metadata['target_framework'] = target_framework
        else:
            target_frameworks = self._get_element_text(root, 'TargetFrameworks', namespace)
            if target_frameworks:
                metadata['target_frameworks'] = target_frameworks

        # Extract other common properties
        metadata['assembly_name'] = self._get_element_text(root, 'AssemblyName', namespace)
        metadata['root_namespace'] = self._get_element_text(root, 'RootNamespace', namespace)
        metadata['output_type'] = self._get_element_text(root, 'OutputType', namespace)

        # Determine project style
        if root.get('Sdk'):
            metadata['project_style'] = 'SDK-style'
            metadata['sdk'] = root.get('Sdk')
        else:
            metadata['project_style'] = 'Legacy'

        return metadata

    def _get_element_text(self, element, tag: str, namespace: str) -> Optional[str]:
        """Get text content of an element"""
        if namespace:
            elem = element.find(f'.//{{{namespace}}}{tag}')
        else:
            elem = element.find(f'.//{tag}')

        return elem.text.strip() if elem is not None and elem.text else None

    def _normalize_version(self, version: str) -> Optional[str]:
        """
        Normalize .NET version specifications

        Handles:
        - Wildcards: 2.12.* -> 2.12.0
        - Ranges: [12.0.0,13.0.0) -> 12.0.0 (use minimum)
        - Exact: 2.12.0 -> 2.12.0
        """
        if not version:
            return None

        version = version.strip()

        # Handle wildcard versions (2.12.*)
        if '*' in version:
            # Replace * with 0
            return version.replace('*', '0')

        # Handle version ranges [min,max)
        if version.startswith('[') or version.startswith('('):
            # Extract minimum version from range
            # [12.0.0,13.0.0) -> 12.0.0
            match = re.search(r'[\[\(]([0-9\.]+)', version)
            if match:
                return match.group(1)

        # Return as-is for exact versions
        return version
