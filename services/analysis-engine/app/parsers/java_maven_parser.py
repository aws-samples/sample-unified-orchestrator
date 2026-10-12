"""
Maven POM.xml Parser

Parses Maven pom.xml files to extract dependencies with version resolution.
Supports property substitution, dependencyManagement, and parent POM inheritance.
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


class MavenParser:
    """
    Parser for Maven pom.xml files

    Features:
    - Extract dependencies from <dependencies> section
    - Resolve property substitution (${property.name})
    - Resolve versions from <dependencyManagement>
    - Handle parent POM inheritance (basic)
    - Map scope to dependency type
    - Support multi-module projects
    """

    # Maven namespaces
    NAMESPACES = {
        'maven': 'http://maven.apache.org/POM/4.0.0'
    }

    # Scope to dependency type mapping
    SCOPE_MAPPING = {
        'compile': 'Runtime',
        'provided': 'Provided',
        'runtime': 'Runtime',
        'test': 'Test',
        'system': 'System',
        'import': 'Import'
    }

    def __init__(self):
        """Initialize Maven Parser"""
        if ET is None:
            raise ImportError("defusedxml is required for Maven parsing")
        logger.info("Maven Parser initialized")

    def parse_pom(self, pom_path: str) -> Dict[str, Any]:
        """
        Parse a Maven pom.xml file

        Args:
            pom_path: Path to pom.xml file

        Returns:
            Dictionary with parsed dependencies and metadata
        """
        try:
            pom_file = Path(pom_path)

            if not pom_file.exists():
                return {
                    "success": False,
                    "error": f"POM file not found: {pom_path}"
                }

            logger.info(f"Parsing Maven POM: {pom_path}")

            # Parse XML
            tree = ET.parse(pom_path)
            root = tree.getroot()

            # Extract namespace
            namespace = self._extract_namespace(root)

            # Extract properties for variable substitution
            properties = self._extract_properties(root, namespace)

            # Extract parent POM information
            parent_info = self._extract_parent_info(root, namespace)

            # Extract dependencyManagement for version resolution
            dependency_management = self._extract_dependency_management(root, namespace, properties)

            # If parent POM exists and we have unresolved versions, try to resolve from parent
            if parent_info and not dependency_management:
                logger.info(f"Attempting to resolve versions from parent POM: {parent_info['artifact_id']}")
                parent_dep_mgmt = self._resolve_from_parent_pom(parent_info, pom_file.parent)
                if parent_dep_mgmt:
                    dependency_management.update(parent_dep_mgmt)

            # Extract dependencies
            dependencies = self._extract_dependencies(root, namespace, properties, dependency_management)

            # Extract project metadata
            metadata = self._extract_metadata(root, namespace, properties)

            logger.info(f"Extracted {len(dependencies)} dependencies from {pom_path}")

            return {
                "success": True,
                "file_path": str(pom_path),
                "dependencies": dependencies,
                "metadata": metadata,
                "properties": properties,
                "total_dependencies": len(dependencies)
            }

        except ET.ParseError as e:
            logger.error(f"XML parsing error in {pom_path}: {e}")
            return {
                "success": False,
                "error": f"XML parsing error: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Failed to parse Maven POM {pom_path}: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Failed to parse Maven POM: {str(e)}"
            }

    def _extract_namespace(self, root) -> str:
        """Extract XML namespace from root element"""
        match = re.match(r'\{(.*)\}', root.tag)
        return match.group(1) if match else ''

    def _extract_properties(self, root, namespace: str) -> Dict[str, str]:
        """Extract properties for variable substitution"""
        properties = {}

        # Find properties element
        ns = {'maven': namespace} if namespace else {}
        properties_elem = root.find('maven:properties', ns) if namespace else root.find('properties')

        if properties_elem is not None:
            for prop in properties_elem:
                # Remove namespace from tag
                tag = prop.tag.split('}')[-1] if '}' in prop.tag else prop.tag
                properties[tag] = prop.text or ''

        # Add built-in properties
        properties['project.version'] = self._get_element_text(root, 'version', namespace)
        properties['project.groupId'] = self._get_element_text(root, 'groupId', namespace)
        properties['project.artifactId'] = self._get_element_text(root, 'artifactId', namespace)

        return properties

    def _extract_dependency_management(self, root, namespace: str, properties: Dict[str, str]) -> Dict[str, str]:
        """Extract dependencyManagement for version resolution"""
        managed_versions = {}

        ns = {'maven': namespace} if namespace else {}
        dep_mgmt = root.find('maven:dependencyManagement', ns) if namespace else root.find('dependencyManagement')

        if dep_mgmt is not None:
            deps_elem = dep_mgmt.find('maven:dependencies', ns) if namespace else dep_mgmt.find('dependencies')

            if deps_elem is not None:
                for dep in deps_elem.findall('maven:dependency', ns) if namespace else deps_elem.findall('dependency'):
                    group_id = self._get_element_text(dep, 'groupId', namespace)
                    artifact_id = self._get_element_text(dep, 'artifactId', namespace)
                    version = self._get_element_text(dep, 'version', namespace)
                    dep_type = self._get_element_text(dep, 'type', namespace)
                    scope = self._get_element_text(dep, 'scope', namespace)

                    if group_id and artifact_id and version:
                        # Resolve property references
                        version = self._resolve_properties(version, properties)
                        key = f"{group_id}:{artifact_id}"

                        # Check if this is a BOM import
                        if dep_type == 'pom' and scope == 'import':
                            logger.info(f"Found BOM import: {key}:{version}")
                            # Fetch and merge the BOM
                            bom_versions = self._fetch_parent_pom_from_maven_central(
                                group_id, artifact_id, version, depth=0, max_depth=2
                            )
                            managed_versions.update(bom_versions)
                        else:
                            managed_versions[key] = version

        return managed_versions

    def _extract_dependencies(
        self,
        root,
        namespace: str,
        properties: Dict[str, str],
        dependency_management: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        """Extract dependencies from pom.xml"""
        dependencies = []

        ns = {'maven': namespace} if namespace else {}
        deps_elem = root.find('maven:dependencies', ns) if namespace else root.find('dependencies')

        if deps_elem is None:
            return dependencies

        for dep in deps_elem.findall('maven:dependency', ns) if namespace else deps_elem.findall('dependency'):
            group_id = self._get_element_text(dep, 'groupId', namespace)
            artifact_id = self._get_element_text(dep, 'artifactId', namespace)
            version = self._get_element_text(dep, 'version', namespace)
            scope = self._get_element_text(dep, 'scope', namespace) or 'compile'
            optional = self._get_element_text(dep, 'optional', namespace)

            if not group_id or not artifact_id:
                continue

            # Resolve version from dependencyManagement if not specified
            if not version:
                key = f"{group_id}:{artifact_id}"
                version = dependency_management.get(key, '')

            # Resolve property references
            if version:
                version = self._resolve_properties(version, properties)

            # Map scope to dependency type
            dep_type = self.SCOPE_MAPPING.get(scope, 'Runtime')

            dependency = {
                'group_id': group_id,
                'artifact_id': artifact_id,
                'version': version or 'UNRESOLVED',
                'scope': scope,
                'type': dep_type,
                'optional': optional == 'true',
                'ecosystem': 'Java',
                'package_manager': 'Maven',
                'name': f"{group_id}:{artifact_id}",
                'full_name': f"{group_id}:{artifact_id}:{version}" if version else f"{group_id}:{artifact_id}"
            }

            dependencies.append(dependency)

        return dependencies

    def _extract_metadata(self, root, namespace: str, properties: Dict[str, str]) -> Dict[str, str]:
        """Extract project metadata"""
        metadata = {
            'group_id': self._get_element_text(root, 'groupId', namespace),
            'artifact_id': self._get_element_text(root, 'artifactId', namespace),
            'version': self._get_element_text(root, 'version', namespace),
            'name': self._get_element_text(root, 'name', namespace),
            'description': self._get_element_text(root, 'description', namespace),
            'packaging': self._get_element_text(root, 'packaging', namespace) or 'jar'
        }

        # Check for parent POM
        ns = {'maven': namespace} if namespace else {}
        parent = root.find('maven:parent', ns) if namespace else root.find('parent')
        if parent is not None:
            metadata['parent_group_id'] = self._get_element_text(parent, 'groupId', namespace)
            metadata['parent_artifact_id'] = self._get_element_text(parent, 'artifactId', namespace)
            metadata['parent_version'] = self._get_element_text(parent, 'version', namespace)

        return metadata

    def _extract_parent_info(self, root, namespace: str) -> Optional[Dict[str, str]]:
        """Extract parent POM information"""
        ns = {'maven': namespace} if namespace else {}
        parent = root.find('maven:parent', ns) if namespace else root.find('parent')

        if parent is None:
            return None

        return {
            'group_id': self._get_element_text(parent, 'groupId', namespace),
            'artifact_id': self._get_element_text(parent, 'artifactId', namespace),
            'version': self._get_element_text(parent, 'version', namespace)
        }

    def _resolve_from_parent_pom(self, parent_info: Dict[str, str], repo_dir: Path) -> Dict[str, str]:
        """
        Resolve dependency versions from parent POM

        Tries to fetch parent POM from Maven Central first, then checks local filesystem.

        Args:
            parent_info: Parent POM information
            repo_dir: Repository directory

        Returns:
            Dictionary of managed dependency versions
        """
        managed_versions = {}

        # Try to fetch from Maven Central (works for any public parent POM)
        logger.info(f"Attempting to resolve parent POM: {parent_info['group_id']}:{parent_info['artifact_id']}:{parent_info['version']}")

        managed_versions = self._fetch_parent_pom_from_maven_central(
            parent_info['group_id'],
            parent_info['artifact_id'],
            parent_info['version']
        )

        if managed_versions:
            logger.info(f"Successfully resolved {len(managed_versions)} dependencies from parent POM via Maven Central")
            return managed_versions

        # Fallback: Check for local parent POM in repository
        logger.info("Maven Central fetch failed, checking for local parent POM")
        local_parent_path = repo_dir.parent / 'pom.xml'

        if local_parent_path.exists():
            logger.info(f"Found local parent POM: {local_parent_path}")
            result = self.parse_pom(str(local_parent_path))
            if result.get('success'):
                # Extract dependencyManagement from local parent
                tree = ET.parse(str(local_parent_path))
                root = tree.getroot()
                namespace = self._extract_namespace(root)
                properties = self._extract_properties(root, namespace)
                managed_versions = self._extract_dependency_management(root, namespace, properties)
                logger.info(f"Resolved {len(managed_versions)} dependencies from local parent POM")

        return managed_versions

    def _get_spring_boot_managed_versions(self, spring_boot_version: str) -> Dict[str, str]:
        """
        Get managed dependency versions from Spring Boot parent POM

        Fetches the actual parent POM from Maven Central and parses it.
        Falls back to hardcoded versions if fetch fails.

        Args:
            spring_boot_version: Spring Boot version

        Returns:
            Dictionary of managed dependency versions
        """
        # Try to fetch from Maven Central
        managed_versions = self._fetch_parent_pom_from_maven_central(
            'org.springframework.boot',
            'spring-boot-starter-parent',
            spring_boot_version
        )

        if managed_versions:
            logger.info(f"Fetched {len(managed_versions)} managed versions from Maven Central for Spring Boot {spring_boot_version}")
            return managed_versions

        # Fallback to hardcoded versions for common Spring Boot versions
        logger.warning(f"Failed to fetch from Maven Central, using fallback versions for Spring Boot {spring_boot_version}")
        return self._get_fallback_spring_boot_versions(spring_boot_version)

    def _fetch_parent_pom_from_maven_central(
        self,
        group_id: str,
        artifact_id: str,
        version: str,
        depth: int = 0,
        max_depth: int = 3
    ) -> Dict[str, str]:
        """
        Fetch and parse parent POM from Maven Central (recursively)

        Args:
            group_id: Maven group ID
            artifact_id: Maven artifact ID
            version: Version
            depth: Current recursion depth
            max_depth: Maximum recursion depth

        Returns:
            Dictionary of managed dependency versions
        """
        if depth >= max_depth:
            logger.warning(f"Reached maximum parent POM depth ({max_depth})")
            return {}

        try:
            import urllib.request
            import urllib.error

            # Convert group_id to path (e.g., org.springframework.boot -> org/springframework/boot)
            group_path = group_id.replace('.', '/')

            # Maven Central URL
            pom_url = f"https://repo1.maven.org/maven2/{group_path}/{artifact_id}/{version}/{artifact_id}-{version}.pom"

            logger.info(f"Fetching parent POM (depth {depth}): {pom_url}")

            # Fetch POM with timeout — only allow HTTPS scheme
            if not pom_url.startswith('https://'):
                logger.warning(f"Refusing to fetch non-HTTPS URL: {pom_url}")
                return {}

            request = urllib.request.Request(pom_url)
            request.add_header('User-Agent', 'Repository-Analyzer/1.0')

            with urllib.request.urlopen(request, timeout=10) as response:  # nosec B310 - URL scheme validated above
                pom_content = response.read()

            # Parse the POM XML using defusedxml
            root = ET.fromstring(pom_content)

            # Extract namespace
            namespace = self._extract_namespace(root)

            # Extract properties
            properties = self._extract_properties(root, namespace)

            # Extract dependencyManagement
            managed_versions = self._extract_dependency_management(root, namespace, properties)

            logger.info(f"Parsed parent POM (depth {depth}), found {len(managed_versions)} managed dependencies")

            # Check if this POM has a parent and recursively fetch it
            # For Spring Boot parent POMs, we need to fetch the parent (spring-boot-dependencies)
            # which contains the actual dependency management
            parent_info = self._extract_parent_info(root, namespace)
            if parent_info:
                # Always fetch parent for spring-boot-starter-parent as it delegates to spring-boot-dependencies
                # For other POMs, only fetch if we have few managed dependencies
                should_fetch_parent = (
                    artifact_id == 'spring-boot-starter-parent' or
                    artifact_id == 'spring-boot-dependencies' or
                    len(managed_versions) < 10
                )

                if should_fetch_parent:
                    logger.info(f"Fetching parent POM: {parent_info['artifact_id']} (current has {len(managed_versions)} deps)")
                    parent_managed = self._fetch_parent_pom_from_maven_central(
                        parent_info['group_id'],
                        parent_info['artifact_id'],
                        parent_info['version'],
                        depth + 1,
                        max_depth
                    )
                    # Parent dependencies should not override child dependencies
                    for key, value in parent_managed.items():
                        if key not in managed_versions:
                            managed_versions[key] = value

            return managed_versions

        except urllib.error.HTTPError as e:
            logger.warning(f"HTTP error fetching parent POM: {e.code} - {e.reason}")
            return {}
        except urllib.error.URLError as e:
            logger.warning(f"URL error fetching parent POM: {e.reason}")
            return {}
        except Exception as e:
            logger.warning(f"Error fetching/parsing parent POM: {e}")
            return {}

    def _get_fallback_spring_boot_versions(self, spring_boot_version: str) -> Dict[str, str]:
        """
        Fallback hardcoded versions for common Spring Boot releases

        Used only when Maven Central fetch fails (offline scenarios)

        Args:
            spring_boot_version: Spring Boot version

        Returns:
            Dictionary of managed dependency versions
        """
        managed_versions = {}

        # All Spring Boot starters use the same version as the parent
        spring_boot_starters = [
            'spring-boot-starter-actuator',
            'spring-boot-starter-cache',
            'spring-boot-starter-data-jpa',
            'spring-boot-starter-thymeleaf',
            'spring-boot-starter-validation',
            'spring-boot-starter-webmvc',
            'spring-boot-starter-web',
            'spring-boot-starter-test',
            'spring-boot-devtools',
            'spring-boot-starter-data-jpa-test',
            'spring-boot-starter-restclient-test',
            'spring-boot-starter-webmvc-test',
            'spring-boot-testcontainers',
            'spring-boot-docker-compose'
        ]

        for starter in spring_boot_starters:
            managed_versions[f'org.springframework.boot:{starter}'] = spring_boot_version

        # Common third-party dependencies (approximate versions)
        # These are rough estimates and may not be exact
        if spring_boot_version.startswith('4.') or spring_boot_version.startswith('3.'):
            managed_versions.update({
                'javax.cache:cache-api': '1.1.1',
                'jakarta.xml.bind:jakarta.xml.bind-api': '4.0.2',
                'com.h2database:h2': '2.3.232',
                'org.postgresql:postgresql': '42.7.4',
                'com.mysql:mysql-connector-j': '9.1.0',
                'org.testcontainers:testcontainers-junit-jupiter': '1.20.4',
                'org.testcontainers:testcontainers-mysql': '1.20.4'
            })
        elif spring_boot_version.startswith('2.'):
            managed_versions.update({
                'javax.cache:cache-api': '1.1.1',
                'javax.xml.bind:jaxb-api': '2.3.1',
                'com.h2database:h2': '1.4.200',
                'org.postgresql:postgresql': '42.2.23',
                'mysql:mysql-connector-java': '8.0.26',
                'org.testcontainers:testcontainers-junit-jupiter': '1.17.0',
                'org.testcontainers:testcontainers-mysql': '1.17.0'
            })
        elif spring_boot_version.startswith('1.'):
            # Spring Boot 1.x versions
            managed_versions.update({
                'javax.cache:cache-api': '1.0.0',
                'com.h2database:h2': '1.4.193',
                'org.hsqldb:hsqldb': '2.3.3',
                'org.postgresql:postgresql': '9.4.1212',
                'mysql:mysql-connector-java': '5.1.41',
                'com.fasterxml.jackson.core:jackson-databind': '2.8.7',
                'org.ehcache:ehcache': '3.2.1',
                'org.springframework:spring-web': '4.3.7.RELEASE',
                'org.springframework.boot:spring-boot-starter-data-rest': spring_boot_version
            })

        logger.info(f"Using fallback versions: {len(managed_versions)} managed dependencies")
        return managed_versions

    def _get_element_text(self, element, tag: str, namespace: str) -> Optional[str]:
        """Get text content of an element"""
        if namespace:
            elem = element.find(f'{{{namespace}}}{tag}')
        else:
            elem = element.find(tag)

        return elem.text.strip() if elem is not None and elem.text else None

    def _resolve_properties(self, value: str, properties: Dict[str, str]) -> str:
        """Resolve property references like ${property.name}"""
        if not value or '${' not in value:
            return value

        # Find all property references
        pattern = r'\$\{([^}]+)\}'
        matches = re.findall(pattern, value)

        resolved = value
        for prop_name in matches:
            if prop_name in properties:
                resolved = resolved.replace(f'${{{prop_name}}}', properties[prop_name])
            else:
                logger.warning(f"Unresolved property: {prop_name}")

        return resolved
