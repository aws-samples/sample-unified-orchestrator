"""
Gradle Build File Parser

Parses Gradle build.gradle and build.gradle.kts files using regex patterns.
Does not execute code - uses static analysis only for security.
"""

import logging
import re
from typing import Dict, List, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class GradleParser:
    """
    Parser for Gradle build files (Groovy and Kotlin DSL)

    Features:
    - Parse build.gradle (Groovy DSL)
    - Parse build.gradle.kts (Kotlin DSL)
    - Resolve variable substitution from ext block
    - Map configuration types (implementation, testImplementation, etc.)
    - Handle both single and double quotes
    - Skip complex dynamic dependencies (no code execution)
    """

    # Configuration to dependency type mapping
    CONFIG_MAPPING = {
        'implementation': 'Runtime',
        'api': 'Runtime',
        'compile': 'Runtime',
        'compileOnly': 'Provided',
        'runtimeOnly': 'Runtime',
        'testImplementation': 'Test',
        'testCompile': 'Test',
        'testRuntimeOnly': 'Test',
        'androidTestImplementation': 'Test',
        'annotationProcessor': 'Annotation Processor',
        'kapt': 'Annotation Processor'
    }

    def __init__(self):
        """Initialize Gradle Parser"""
        logger.info("Gradle Parser initialized")

    def parse_gradle(self, gradle_path: str) -> Dict[str, Any]:
        """
        Parse a Gradle build file

        Args:
            gradle_path: Path to build.gradle or build.gradle.kts file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            gradle_file = Path(gradle_path)

            if not gradle_file.exists():
                return {
                    "success": False,
                    "error": f"Gradle file not found: {gradle_path}"
                }

            logger.info(f"Parsing Gradle build file: {gradle_path}")

            # Read file content
            content = gradle_file.read_text(encoding='utf-8')

            # Determine DSL type
            is_kotlin = gradle_file.name.endswith('.kts')

            # Extract variables for substitution
            variables = self._extract_variables(content, is_kotlin)

            # Extract dependencies
            dependencies = self._extract_dependencies(content, is_kotlin, variables)

            # Extract metadata
            metadata = self._extract_metadata(content, is_kotlin, gradle_file.name)

            logger.info(f"Extracted {len(dependencies)} dependencies from {gradle_path}")

            return {
                "success": True,
                "file_path": str(gradle_path),
                "dependencies": dependencies,
                "metadata": metadata,
                "variables": variables,
                "total_dependencies": len(dependencies),
                "dsl_type": "Kotlin" if is_kotlin else "Groovy"
            }

        except Exception as e:
            logger.error(f"Failed to parse Gradle file {gradle_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse Gradle file: {str(e)}"
            }

    def _extract_variables(self, content: str, is_kotlin: bool) -> Dict[str, str]:
        """Extract variables from ext block or top-level declarations"""
        variables = {}

        if is_kotlin:
            # Kotlin DSL: val kotlinVersion = "1.8.0"
            pattern = r'val\s+(\w+)\s*=\s*["\']([^"\']+)["\']'
        else:
            # Groovy DSL: ext.springVersion = "5.3.0" or ext { springVersion = "5.3.0" }
            # Simple pattern for ext.variable = "value"
            pattern = r'ext\.(\w+)\s*=\s*["\']([^"\']+)["\']'

        matches = re.findall(pattern, content)
        for var_name, var_value in matches:
            variables[var_name] = var_value

        # Also extract from ext block
        if not is_kotlin:
            ext_block_pattern = r'ext\s*\{([^}]+)\}'
            ext_blocks = re.findall(ext_block_pattern, content, re.DOTALL)
            for block in ext_blocks:
                # Extract variable = "value" from block
                var_pattern = r'(\w+)\s*=\s*["\']([^"\']+)["\']'
                var_matches = re.findall(var_pattern, block)
                for var_name, var_value in var_matches:
                    variables[var_name] = var_value

        return variables

    def _extract_dependencies(self, content: str, is_kotlin: bool, variables: Dict[str, str]) -> List[Dict[str, Any]]:
        """Extract dependencies from Gradle file"""
        dependencies = []

        if is_kotlin:
            # Kotlin DSL patterns
            # implementation("group:artifact:version")
            # implementation("group", "artifact", "version")
            patterns = [
                r'(\w+)\s*\(\s*["\']([^:"\']+):([^:"\']+):([^"\']+)["\']\s*\)',  # Single string format
                r'(\w+)\s*\(\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']+)["\']\s*\)'  # Three string format
            ]
        else:
            # Groovy DSL patterns
            # implementation 'group:artifact:version'
            # implementation group: 'group', name: 'artifact', version: 'version'
            patterns = [
                r'(\w+)\s+["\']([^:"\']+):([^:"\']+):([^"\']+)["\']',  # Single string format
                r'(\w+)\s+group:\s*["\']([^"\']+)["\']\s*,\s*name:\s*["\']([^"\']+)["\']\s*,\s*version:\s*["\']([^"\']+)["\']'  # Map format
            ]

        for pattern in patterns:
            matches = re.findall(pattern, content)
            for match in matches:
                if len(match) == 4:
                    config, group, artifact, version = match

                    # Skip if it looks like a dynamic dependency
                    if any(char in version for char in ['+']) or version in ['latest.release', 'latest.integration']:
                        # Try to resolve simple variable references
                        if version.startswith('$'):
                            var_name = version.strip('${}')
                            version = variables.get(var_name, version)
                            if any(char in version for char in ['+']) or version in ['latest.release', 'latest.integration']:
                                logger.warning(f"Skipping dynamic dependency: {group}:{artifact}:{version}")
                                continue
                        else:
                            logger.warning(f"Skipping dynamic dependency: {group}:{artifact}:{version}")
                            continue

                    # Resolve variable references
                    version = self._resolve_variables(version, variables)

                    # Map configuration to dependency type
                    dep_type = self.CONFIG_MAPPING.get(config, 'Runtime')

                    dependency = {
                        'group_id': group,
                        'artifact_id': artifact,
                        'version': version,
                        'configuration': config,
                        'type': dep_type,
                        'ecosystem': 'Java',
                        'package_manager': 'Gradle',
                        'name': f"{group}:{artifact}",
                        'full_name': f"{group}:{artifact}:{version}"
                    }

                    dependencies.append(dependency)

        return dependencies

    def _extract_metadata(self, content: str, is_kotlin: bool, filename: str) -> Dict[str, str]:
        """Extract project metadata"""
        metadata = {
            'build_file': filename,
            'dsl_type': 'Kotlin' if is_kotlin else 'Groovy'
        }

        # Extract group
        group_pattern = r'group\s*=\s*["\']([^"\']+)["\']'
        group_match = re.search(group_pattern, content)
        if group_match:
            metadata['group'] = group_match.group(1)

        # Extract version
        version_pattern = r'version\s*=\s*["\']([^"\']+)["\']'
        version_match = re.search(version_pattern, content)
        if version_match:
            metadata['version'] = version_match.group(1)

        # Extract plugins
        if is_kotlin:
            plugin_pattern = r'id\s*\(\s*["\']([^"\']+)["\']\s*\)'
        else:
            plugin_pattern = r'id\s+["\']([^"\']+)["\']'

        plugins = re.findall(plugin_pattern, content)
        if plugins:
            metadata['plugins'] = plugins

        return metadata

    def _resolve_variables(self, value: str, variables: Dict[str, str]) -> str:
        """Resolve variable references"""
        if not value or '$' not in value:
            return value

        # Handle ${variable} or $variable
        for var_name, var_value in variables.items():
            value = value.replace(f'${{{var_name}}}', var_value)
            value = value.replace(f'${var_name}', var_value)

        return value
