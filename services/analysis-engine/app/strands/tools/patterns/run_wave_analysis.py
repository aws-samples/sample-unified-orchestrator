"""
Run Wave Analysis Tool

Analyzes applications in a wave and identifies migration patterns based on
replatforming-impacting components and their target versions from assessment reports.

Process:
1. Get components from app_components table
2. Filter to replatforming-impacting categories (Runtime, Database, App Server, etc.)
3. Extract target versions from S3 assessment reports
4. Match components with targets and identify upgrade patterns
5. Generate pattern signatures and human-readable names
"""

import logging
import hashlib
from typing import Dict, Any, List
from strands import tool

from app.config import Config

logger = logging.getLogger(__name__)

# Initialize AWS clients using Config
dynamodb = Config.get_boto3_resource('dynamodb')
app_components_table_name = Config.APP_COMPONENTS_TABLE
app_components_table = dynamodb.Table(app_components_table_name)

# Default similarity threshold (70%)
DEFAULT_SIMILARITY_THRESHOLD = 70

# Categories that impact application replatforming/rebuilding
# Using actual category names from the data
REPLATFORMING_CATEGORIES = {
    'Operating Systems',           # OS upgrades require replatforming
    'Relational Database',         # Database changes require schema/query updates
    'NoSQL Database',              # Database changes require schema/query updates
    'Application Servers',         # App server changes require deployment updates
    'Web Servers',                 # Web server changes require config updates
    'Middleware',                  # Middleware changes require integration updates
}

# Sub-categories that indicate replatforming impact
REPLATFORMING_SUBCATEGORIES = {
    'Linux',                       # OS
    'Unix',                        # OS
    'Windows',                     # OS
    'Database Management',         # Database
    'Relational Database',         # Database
    'NoSQL Database',             # Database
    'Application Server',          # App Server
    'Web Server',                  # Web Server
    'Message Queue',               # Middleware
    'ESB',                        # Middleware
}

# Product name patterns that indicate replatforming components
# These are semantic matches for runtime environments, databases, etc.
REPLATFORMING_PRODUCT_PATTERNS = {
    # Runtime/Language
    'java', 'jdk', 'jre', 'openjdk', 'oracle jdk',
    'python', 'python2', 'python3',
    'node', 'nodejs', 'node.js',
    'ruby', 'perl', 'php',
    '.net', 'dotnet', 'asp.net',
    'go', 'golang',

    # Databases
    'oracle', 'mysql', 'mariadb', 'postgresql', 'postgres',
    'mongodb', 'redis', 'cassandra', 'couchbase',
    'db2', 'sql server', 'sqlserver', 'mssql',

    # Application Servers
    'tomcat', 'websphere', 'weblogic', 'jboss', 'wildfly',
    'glassfish', 'jetty', 'undertow',

    # Web Servers
    'apache', 'httpd', 'nginx', 'iis',

    # Middleware
    'rabbitmq', 'activemq', 'kafka',
    'mule', 'tibco',
}

# Component deduplication rules
# If parent component exists, skip child components
COMPONENT_HIERARCHY = {
    'jdk': ['jre', 'java'],  # If JDK exists, skip JRE and generic Java
    'oracle database': ['oracle sql*plus', 'oracle instant client', 'oracle call interface', 'oracle odbc',
                        'oracle net services', 'oracle sqlj', 'oracle xml developer kit', 'oracle java client',
                        'oracle programmer', 'oracle text', 'oracle workspace manager', 'oracle recovery manager',
                        'oracle wallet manager', 'oracle application express', 'oracle multimedia',
                        'oracle multimedia client', 'oracle spatial', 'oracle olap', 'oracle partitioning',
                        'oracle label security', 'oracle database vault', 'oracle advanced security',
                        'oracle real application testing', 'oracle database migration assistant'],
    'weblogic': ['oracle coherence', 'oracle containers for java', 'oracle universal connection pool'],
    'websphere': ['websphere application server'],
    'python3': ['python', 'python2'],
    'rhel': ['red hat enterprise linux'],
}

# Components to exclude (not truly impactful for replatforming)
EXCLUDED_COMPONENTS = {
    # Development/Build tools (not runtime dependencies)
    'oracle security developer tools',
    'oracle directory client',
    'oracle database gateway',

    # Utilities that don't affect application code
    'procmail',  # Mail processing utility
    'sendmail',  # Mail server
    'postfix',   # Mail server

    # Python libraries (not core runtime)
    'python-simplejson',
    'python-requests',
}


@tool
def run_wave_analysis(reports_data: Dict[str, Any], similarity_threshold: int = DEFAULT_SIMILARITY_THRESHOLD) -> Dict[str, Any]:
    """
    Analyze applications in a wave and identify migration patterns.

    This tool:
    1. Retrieves replatforming-impacting components from DynamoDB
    2. Extracts target versions from assessment reports in S3
    3. Identifies version upgrade patterns
    4. Checks for existing patterns in wave_patterns table
    5. Reuses existing pattern_id when component transformations match (based on similarity threshold)
    6. Generates pattern signatures and human-readable names

    Pattern States:
    - PATTERN_XXXXXX: Has version changes requiring migration
    - NO_PATTERN_REQ: All components already at target (no migration needed)
    - NO_PATTERN_IDENTIFIED: No target versions defined (assessment needed)

    Args:
        reports_data: Data from retrieve_reports_for_wave containing:
            - wave_id: Wave identifier
            - reports: List of assessment reports with app_id, app_name, report
        similarity_threshold: Percentage threshold for grouping similar patterns (default: 70)

    Returns:
        Dictionary containing:
        - wave_id: The wave ID
        - application_patterns: List of applications with their patterns
        - applications_analyzed: Count of applications analyzed
        - patterns_ready_for_grouping: Boolean flag
        - similarity_threshold: The threshold used
        - existing_patterns_reused: Count of patterns reused from wave_patterns table
    """
    logger.info(f"Running wave analysis for wave {reports_data.get('wave_id')} with {similarity_threshold}% similarity threshold")

    try:
        wave_id = reports_data.get('wave_id')
        reports = reports_data.get('reports', [])

        if not reports:
            logger.warning(f"No reports available for wave {wave_id}")
            return {
                'wave_id': wave_id,
                'application_patterns': [],
                'applications_analyzed': 0,
                'patterns_ready_for_grouping': True,
                'similarity_threshold': similarity_threshold,
                'existing_patterns_reused': 0,
                'error': 'No reports available for analysis'
            }

        # Step 0: Load existing patterns from wave_patterns table
        existing_patterns = _load_existing_patterns(wave_id)
        logger.info(f"Loaded {len(existing_patterns)} existing patterns from wave_patterns table")

        # Analyze each application
        application_patterns = []
        patterns_reused = 0

        for report_entry in reports:
            app_id = report_entry.get('app_id')
            app_name = report_entry.get('app_name')
            report = report_entry.get('report', {})

            logger.info(f"Analyzing application {app_id}: {app_name}")

            try:
                # Step 1: Get replatforming-impacting components from DynamoDB
                components = _get_replatforming_components(app_id)
                logger.info(f"  Found {len(components)} replatforming-impacting components")

                # Step 2: Extract target versions from assessment report
                target_versions = _extract_target_versions_from_report(report)
                logger.info(f"  Found {len(target_versions)} components with target versions")

                # Step 3: Match components with targets and analyze pattern
                pattern_result = _analyze_application_pattern(
                    app_id,
                    app_name,
                    components,
                    target_versions
                )

                # Step 4: Check if similar pattern exists and reuse pattern_id
                if pattern_result['pattern_state'] == 'HAS_CHANGES':
                    matched_pattern = _find_matching_pattern(
                        pattern_result['pattern_signature'],
                        existing_patterns,
                        similarity_threshold
                    )

                    if matched_pattern:
                        # Reuse existing pattern_id
                        old_pattern_id = pattern_result['pattern_id']
                        pattern_result['pattern_id'] = matched_pattern['pattern_id']
                        pattern_result['pattern_reused'] = True
                        pattern_result['original_pattern_id'] = old_pattern_id
                        pattern_result['matched_from_app'] = matched_pattern['application_id']
                        pattern_result['atx_name'] = matched_pattern.get('atx_name')
                        pattern_result['atx_mapped'] = bool(matched_pattern.get('atx_name'))
                        patterns_reused += 1
                        logger.info(f"  ✓ Reused existing pattern {matched_pattern['pattern_id']} (from app {matched_pattern['application_id']})")
                        if matched_pattern.get('atx_name'):
                            logger.info(f"    ATX already mapped: {matched_pattern['atx_name']}")
                    else:
                        pattern_result['pattern_reused'] = False
                        pattern_result['atx_mapped'] = False

                application_patterns.append(pattern_result)
                logger.info(f"  Pattern: {pattern_result['pattern_id']} - {pattern_result['human_name']}")

            except Exception as e:
                logger.error(f"Error analyzing application {app_id}: {str(e)}")
                # Add error pattern
                application_patterns.append({
                    'app_id': app_id,
                    'app_name': app_name,
                    'pattern_id': 'ERROR',
                    'pattern_state': 'ERROR',
                    'pattern_signature': f'Error during analysis: {str(e)}',
                    'human_name': 'Analysis Error',
                    'migration_strategy': 'Unknown',
                    'version_changes': [],
                    'change_count': 0,
                    'pattern_reused': False,
                    'atx_mapped': False,
                    'error': str(e)
                })

        logger.info(f"Analyzed {len(application_patterns)} applications for wave {wave_id}")
        logger.info(f"Reused {patterns_reused} existing patterns")

        return {
            'wave_id': wave_id,
            'application_patterns': application_patterns,
            'applications_analyzed': len(application_patterns),
            'patterns_ready_for_grouping': True,
            'similarity_threshold': similarity_threshold,
            'existing_patterns_reused': patterns_reused
        }

    except Exception as e:
        logger.error(f"Error running wave analysis: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'wave_id': reports_data.get('wave_id', 'unknown'),
            'application_patterns': [],
            'applications_analyzed': 0,
            'patterns_ready_for_grouping': False,
            'similarity_threshold': similarity_threshold,
            'existing_patterns_reused': 0,
            'error': str(e)
        }


def _get_replatforming_components(app_id: str) -> List[Dict[str, Any]]:
    """
    Get replatforming-impacting components from DynamoDB.

    Uses multi-level filtering to identify components that impact application rebuilding:
    1. Category matching (Operating Systems, Databases, etc.)
    2. Sub-category matching (Linux, Database Management, etc.)
    3. Semantic product name matching (java, jre, jdk, python, oracle, etc.)

    This ensures we catch components like:
    - JRE, JDK, OpenJDK (all Java runtime)
    - Oracle, MySQL, PostgreSQL (databases)
    - Tomcat, WebSphere, JBoss (app servers)
    - Apache, Nginx (web servers)

    Args:
        app_id: Application ID

    Returns:
        List of component dictionaries with replatforming impact
    """
    try:
        # Query DynamoDB using application_id_index GSI
        response = app_components_table.query(
            IndexName='application_id_index',
            KeyConditionExpression='application_id = :app_id',
            ExpressionAttributeValues={':app_id': str(app_id)}
        )

        all_components = response.get('Items', [])

        # Filter to replatforming-impacting components using multi-level matching
        replatforming_components = []

        for comp in all_components:
            category = comp.get('category', '')
            sub_category = comp.get('sub_category', '')
            product = comp.get('product', '').lower()
            publisher = comp.get('software_publisher', '').lower()

            # Level 1: Category match
            if category in REPLATFORMING_CATEGORIES:
                replatforming_components.append(comp)
                continue

            # Level 2: Sub-category match
            if sub_category in REPLATFORMING_SUBCATEGORIES:
                replatforming_components.append(comp)
                continue

            # Level 3: Semantic product name match
            # Check if product name contains any replatforming pattern
            product_lower = product.lower()
            publisher_lower = publisher.lower()
            combined = f"{publisher_lower} {product_lower}"

            for pattern in REPLATFORMING_PRODUCT_PATTERNS:
                if pattern in product_lower or pattern in combined:
                    replatforming_components.append(comp)
                    break

        logger.info(f"Found {len(replatforming_components)} replatforming components out of {len(all_components)} total for app {app_id}")

        return replatforming_components

    except Exception as e:
        logger.error(f"Error fetching components for app {app_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        return []


def _extract_target_versions_from_report(report: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Extract target versions from assessment report.

    Looks in two places:
    1. risk_assessment.eosl_component_list (primary source)
    2. component_analysis.components (fallback)

    Args:
        report: Assessment report dictionary

    Returns:
        Dictionary mapping "publisher|product" to target version info
    """
    target_versions = {}

    if not report:
        return target_versions

    # Primary source: risk_assessment.eosl_component_list
    risk_assessment = report.get('risk_assessment', {})
    eosl_components = risk_assessment.get('eosl_component_list', [])

    for comp in eosl_components:
        publisher = comp.get('publisher', '')
        product = comp.get('product', '')
        target_version = comp.get('target_version')
        current_version = comp.get('current_version')
        current_eosl = comp.get('eosl_date', '')
        target_eosl = comp.get('target_eosl_date', '') or comp.get('target_eol_date', '')

        # Only include if target version is available
        if target_version and target_version not in ['Not Available', 'Not Found', ''] and publisher and product:
            key = f"{publisher}|{product}"
            target_versions[key] = {
                'publisher': publisher,
                'product': product,
                'current_version': current_version,
                'target_version': target_version,
                'current_eosl': current_eosl,
                'target_eosl': target_eosl
            }

    # Fallback: component_analysis.components
    component_analysis = report.get('component_analysis', {})
    components = component_analysis.get('components', [])

    for comp in components:
        publisher = comp.get('publisher', '')
        product = comp.get('product', '')
        target_version = comp.get('target_version')
        current_version = comp.get('current_version')

        if target_version and target_version not in ['Not Available', 'Not Found', ''] and publisher and product:
            key = f"{publisher}|{product}"
            # Don't overwrite if already exists from eosl_component_list
            if key not in target_versions:
                target_versions[key] = {
                    'publisher': publisher,
                    'product': product,
                    'current_version': current_version,
                    'target_version': target_version
                }

    return target_versions


def _deduplicate_and_filter_components(upgrades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Deduplicate and filter components to show only truly impactful changes.

    Rules:
    1. Remove excluded components (mail servers, build tools, etc.)
    2. Apply component hierarchy (if JDK exists, remove JRE)
    3. Remove duplicate entries (same product, different versions)

    Args:
        upgrades: List of component upgrade dictionaries

    Returns:
        Filtered and deduplicated list of upgrades
    """
    if not upgrades:
        return []

    # Step 1: Filter out excluded components
    filtered = []
    for upgrade in upgrades:
        product_lower = upgrade['product'].lower()
        publisher_lower = upgrade['publisher'].lower()
        combined = f"{publisher_lower} {product_lower}"

        # Check if component should be excluded
        excluded = False
        for excluded_pattern in EXCLUDED_COMPONENTS:
            if excluded_pattern in product_lower or excluded_pattern in combined:
                excluded = True
                logger.debug(f"Excluding component: {upgrade['product']} (matches exclusion pattern: {excluded_pattern})")
                break

        if not excluded:
            filtered.append(upgrade)

    # Step 2: Apply component hierarchy (deduplicate parent-child relationships)
    # Build a map of products we have
    products_map = {}
    for upgrade in filtered:
        product_lower = upgrade['product'].lower()
        publisher_lower = upgrade['publisher'].lower()
        combined = f"{publisher_lower} {product_lower}"
        products_map[combined] = upgrade

    # Check hierarchy rules
    to_remove = set()
    for parent_pattern, child_patterns in COMPONENT_HIERARCHY.items():
        # Check if parent exists
        parent_found = None
        for product_key in products_map.keys():
            if parent_pattern in product_key:
                parent_found = product_key
                break

        # If parent exists, mark children for removal
        if parent_found:
            for child_pattern in child_patterns:
                for product_key in products_map.keys():
                    if child_pattern in product_key and product_key != parent_found:
                        to_remove.add(product_key)
                        logger.debug(f"Removing child component: {product_key} (parent {parent_found} exists)")

    # Remove marked components
    deduplicated = [upgrade for upgrade in filtered
                    if f"{upgrade['publisher'].lower()} {upgrade['product'].lower()}" not in to_remove]

    # Step 3: Remove exact duplicates (same publisher + product)
    seen = set()
    final = []
    for upgrade in deduplicated:
        key = f"{upgrade['publisher']}|{upgrade['product']}"
        if key not in seen:
            seen.add(key)
            final.append(upgrade)
        else:
            logger.debug(f"Removing duplicate: {upgrade['product']}")

    logger.info(f"Component filtering: {len(upgrades)} → {len(filtered)} → {len(deduplicated)} → {len(final)}")

    return final


def _analyze_application_pattern(
    app_id: str,
    app_name: str,
    components: List[Dict[str, Any]],
    target_versions: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Analyze application components and determine migration pattern.

    Pattern States:
    1. PATTERN_XXXXXX - Has version changes requiring migration
    2. NO_PATTERN_REQ - All components already at target (no migration needed)
    3. NO_PATTERN_IDENTIFIED - No target versions defined (assessment needed)

    Args:
        app_id: Application ID
        app_name: Application name
        components: List of replatforming-impacting components
        target_versions: Dictionary of target versions from assessment

    Returns:
        Dictionary with pattern analysis results
    """
    upgrades = []
    no_change = []
    no_target = []

    # Match components with target versions
    for comp in components:
        publisher = comp.get('software_publisher', '')
        product = comp.get('product', '')
        current_version = comp.get('normalized_version', '')
        category = comp.get('category', '')

        key = f"{publisher}|{product}"

        if key in target_versions:
            target_info = target_versions[key]
            target_version = target_info['target_version']

            # Only add to upgrades if versions are different
            if current_version != target_version:
                upgrades.append({
                    'publisher': publisher,
                    'product': product,
                    'category': category,
                    'current_version': current_version,
                    'target_version': target_version
                })
            else:
                no_change.append({
                    'publisher': publisher,
                    'product': product,
                    'category': category,
                    'version': current_version
                })
        else:
            no_target.append({
                'publisher': publisher,
                'product': product,
                'category': category,
                'current_version': current_version
            })

    # Deduplicate and filter upgrades
    upgrades = _deduplicate_and_filter_components(upgrades)

    # Determine pattern state
    total_components = len(components)

    # State 1: Has version changes - PATTERN_XXXXXX
    if upgrades:
        pattern_signature = _generate_pattern_signature(upgrades)
        pattern_id = _generate_pattern_id(pattern_signature)
        human_name = _generate_human_name(upgrades)
        migration_strategy = _determine_migration_strategy(upgrades)
        description = _generate_pattern_description(upgrades)

        # Create components_without_target dictionary
        components_without_target_dict = {}
        for comp in no_target:
            key = f"{comp['publisher']}|{comp['product']}"
            components_without_target_dict[key] = {
                'publisher': comp['publisher'],
                'product': comp['product'],
                'category': comp['category'],
                'current_version': comp['current_version']
            }

        # Create components_at_target dictionary
        components_at_target_dict = {}
        for comp in no_change:
            key = f"{comp['publisher']}|{comp['product']}"
            components_at_target_dict[key] = {
                'publisher': comp['publisher'],
                'product': comp['product'],
                'category': comp['category'],
                'version': comp['version']
            }

        return {
            'app_id': app_id,
            'app_name': app_name,
            'pattern_id': pattern_id,
            'pattern_state': 'HAS_CHANGES',
            'pattern_signature': pattern_signature,
            'human_name': human_name,
            'description': description,
            'migration_strategy': migration_strategy,
            'version_changes': upgrades,
            'components_at_target': components_at_target_dict,
            'components_without_target': components_without_target_dict,
            'change_count': len(upgrades),
            'no_change_count': len(no_change),
            'no_target_count': len(no_target),
            'total_components': total_components
        }

    # State 2: No changes needed - NO_PATTERN_REQ
    elif no_change and not no_target:
        # Create components_at_target dictionary
        components_at_target_dict = {}
        for comp in no_change:
            key = f"{comp['publisher']}|{comp['product']}"
            components_at_target_dict[key] = {
                'publisher': comp['publisher'],
                'product': comp['product'],
                'category': comp['category'],
                'version': comp['version']
            }

        # Generate description
        num_components = len(no_change)
        if num_components == 1:
            description = "1 component already at target version"
        else:
            description = f"All {num_components} components already at target versions"

        return {
            'app_id': app_id,
            'app_name': app_name,
            'pattern_id': 'NO_PATTERN_REQ',
            'pattern_state': 'NO_CHANGES_NEEDED',
            'pattern_signature': 'All components already at target versions',
            'human_name': 'No Migration Required',
            'description': description,
            'migration_strategy': 'None',
            'version_changes': [],
            'components_at_target': components_at_target_dict,
            'components_without_target': {},
            'change_count': 0,
            'no_change_count': len(no_change),
            'no_target_count': 0,
            'total_components': total_components
        }

    # State 3: No target versions - NO_PATTERN_IDENTIFIED
    else:
        # Create components_without_target dictionary
        components_without_target_dict = {}
        for comp in no_target:
            key = f"{comp['publisher']}|{comp['product']}"
            components_without_target_dict[key] = {
                'publisher': comp['publisher'],
                'product': comp['product'],
                'category': comp['category'],
                'current_version': comp['current_version']
            }

        # Create components_at_target dictionary for partial matches
        components_at_target_dict = {}
        for comp in no_change:
            key = f"{comp['publisher']}|{comp['product']}"
            components_at_target_dict[key] = {
                'publisher': comp['publisher'],
                'product': comp['product'],
                'category': comp['category'],
                'version': comp['version']
            }

        # Generate description
        num_missing = len(no_target)
        num_at_target = len(no_change)

        if num_at_target > 0:
            description = f"{num_missing} component(s) missing target versions, {num_at_target} already at target"
        else:
            if num_missing == 1:
                description = "1 component missing target version"
            else:
                description = f"All {num_missing} components missing target versions"

        return {
            'app_id': app_id,
            'app_name': app_name,
            'pattern_id': 'NO_PATTERN_IDENTIFIED',
            'pattern_state': 'NO_TARGET_VERSIONS',
            'pattern_signature': 'Target versions not defined - run risk assessment first',
            'human_name': 'Assessment Required',
            'description': description,
            'migration_strategy': 'Unknown',
            'version_changes': [],
            'components_at_target': components_at_target_dict,
            'components_without_target': components_without_target_dict,
            'change_count': 0,
            'no_change_count': len(no_change),
            'no_target_count': len(no_target),
            'total_components': total_components
        }


def _generate_pattern_signature(upgrades: List[Dict[str, Any]]) -> str:
    """
    Generate pattern signature from version upgrades.

    Example: "WebSphere 7→7.0, Tomcat 7.x→10.1.26, sendmail 8→8.16"

    Args:
        upgrades: List of upgrade dictionaries

    Returns:
        Human-readable pattern signature
    """
    # Sort by product name for consistency
    sorted_upgrades = sorted(upgrades, key=lambda x: x['product'])

    # Create signature parts (limit to top 5 for readability)
    parts = []
    for upgrade in sorted_upgrades[:5]:
        product = upgrade['product']
        current = upgrade['current_version']
        target = upgrade['target_version']
        parts.append(f"{product} {current}→{target}")

    signature = ", ".join(parts)

    # Add count if more than 5
    if len(sorted_upgrades) > 5:
        signature += f" + {len(sorted_upgrades) - 5} more"

    return signature


def _generate_pattern_id(pattern_signature: str) -> str:
    """
    Generate unique alphanumeric pattern ID from signature.

    Format: PATTERN_XXXXXXXX (8-char MD5 hash)

    Args:
        pattern_signature: Pattern signature string

    Returns:
        Pattern ID
    """
    # Using MD5 for non-security purpose (pattern ID generation only)
    hash_object = hashlib.md5(pattern_signature.encode(), usedforsecurity=False)
    hash_hex = hash_object.hexdigest()[:8].upper()
    return f"PATTERN_{hash_hex}"


def _generate_human_name(upgrades: List[Dict[str, Any]]) -> str:
    """
    Generate human-readable pattern name (max 80 chars).

    Examples:
    - "WebSphere 7 + Tomcat 10 Migration"
    - "postfix + procmail Upgrade"
    - "Full Stack Modernization"

    Args:
        upgrades: List of upgrade dictionaries

    Returns:
        Human-readable name (max 80 chars)
    """
    if not upgrades:
        return "No Changes"

    # Get unique products
    unique_products = {}
    for upgrade in upgrades:
        product = upgrade['product']
        if product not in unique_products:
            unique_products[product] = upgrade

    num_products = len(unique_products)

    # Single product
    if num_products == 1:
        product = list(unique_products.keys())[0]
        upgrade = list(unique_products.values())[0]
        target = upgrade['target_version']
        # Extract major version
        major_version = target.split('.')[0] if '.' in target else target.split()[0] if ' ' in target else target
        name = f"{product} {major_version} Upgrade"
        return name[:80]

    # Two products - show both
    elif num_products == 2:
        products = list(unique_products.keys())
        comp1_short = _shorten_component_name(products[0])
        comp2_short = _shorten_component_name(products[1])
        name = f"{comp1_short} + {comp2_short} Migration"
        return name[:80]

    # Three products - show all three
    elif num_products == 3:
        products = list(unique_products.keys())
        comp1_short = _shorten_component_name(products[0])
        comp2_short = _shorten_component_name(products[1])
        comp3_short = _shorten_component_name(products[2])
        name = f"{comp1_short} + {comp2_short} + {comp3_short} Migration"
        return name[:80]

    # Many products - show category or first few
    else:
        # Group by category
        categories = {}
        for upgrade in upgrades:
            category = upgrade.get('category', 'Other')
            if category not in categories:
                categories[category] = []
            categories[category].append(upgrade)

        # If single category, use it
        if len(categories) == 1:
            category_name = list(categories.keys())[0]
            products = list(unique_products.keys())[:3]
            product_names = [_shorten_component_name(p) for p in products]
            remaining = num_products - 3
            if remaining > 0:
                return f"{', '.join(product_names)} + {remaining} more {category_name}"[:80]
            else:
                return f"{', '.join(product_names)} {category_name} Upgrade"[:80]
        else:
            return "Full Stack Modernization"


def _generate_pattern_description(upgrades: List[Dict[str, Any]]) -> str:
    """
    Generate AI-ready transformation instructions for component upgrades.

    Creates detailed, actionable instructions that can be passed to AI systems
    for automated application transformation. Includes specific versions,
    dependencies, and step-by-step guidance.

    Args:
        upgrades: List of upgrade dictionaries

    Returns:
        Detailed transformation instructions for AI systems
    """
    if not upgrades:
        return "STATUS: All components are already at their target versions. No transformation is required for this application. The application is ready for deployment in the target environment."

    num_upgrades = len(upgrades)

    # Start with clear transformation objective
    if num_upgrades == 1:
        description = "TRANSFORMATION OBJECTIVE: Upgrade 1 component to reach target state. "
    else:
        description = f"TRANSFORMATION OBJECTIVE: Upgrade {num_upgrades} components to reach target state. "

    # List all component upgrades with precise details
    description += "COMPONENT UPGRADES REQUIRED: "

    for i, upgrade in enumerate(upgrades):
        publisher = upgrade.get('publisher', '')
        product = upgrade.get('product', '')
        current = upgrade.get('current_version', 'Unknown')
        target = upgrade.get('target_version', 'Unknown')
        category = upgrade.get('category', '')

        # Build component identifier
        component_name = f"{publisher} {product}".strip()
        if not component_name:
            component_name = product

        # Add numbered list item
        description += f"({i+1}) {component_name}: Upgrade from version {current} to version {target}"

        # Add category for context
        if category and category not in ['', 'Unknown']:
            description += f" [{category}]"

        # Add separator
        if i < num_upgrades - 1:
            description += "; "
        else:
            description += ". "

    # Add detailed transformation guidance based on complexity
    description += "TRANSFORMATION STEPS: "

    if num_upgrades == 1:
        upgrade = upgrades[0]
        category = upgrade.get('category', '')
        publisher = upgrade.get('publisher', '')
        product = upgrade.get('product', '')
        current = upgrade.get('current_version', '')
        target = upgrade.get('target_version', '')

        component_name = f"{publisher} {product}".strip() or product

        if 'Runtime' in category or 'Language' in category or 'Development' in category:
            description += f"(1) Update all build configurations and dependency manifests to specify {component_name} version {target}. "
            description += f"(2) Scan codebase for deprecated APIs that were removed between version {current} and {target}. "
            description += "(3) Update code to use replacement APIs and modern patterns. "
            description += "(4) Rebuild application with new runtime version. "
            description += "(5) Execute full test suite including unit tests. "
            # description += "(5) Execute full test suite including unit, integration, and regression tests. "
            # description += "(6) Validate API compatibility and performance benchmarks. "
            description += "(5) Execute full test suite including unit tests. "
            description += f"CRITICAL: Review {component_name} release notes for breaking changes between {current} and {target}."

        elif 'Database' in category:
            # description += f"(1) Create full backup of database before upgrade. "
            description += f"(2) Review {component_name} migration guide from version {current} to {target}. "
            description += "(3) Identify schema changes, deprecated features, and SQL syntax updates required. "
            description += "(4) Update all stored procedures, triggers, and functions for compatibility. "
            description += "(5) Modify application queries to use new syntax and features. "
            description += "(6) Test database upgrade in isolated environment with production data copy. "
            # description += "(7) Validate all CRUD operations and complex queries. "
            # description += "(8) Verify backup/restore procedures work with new version. "
            description += f"CRITICAL: Ensure application connection strings and drivers support {component_name} {target}."

        elif 'Application Server' in category or 'Web Server' in category:
            description += f"(1) Update deployment descriptors (web.xml, server.xml, etc.) for {component_name} {target}. "
            description += "(2) Review and update server configuration files for new version syntax. "
            # description += "(3) Update SSL/TLS configurations to use modern cipher suites. "
            description += "(4) Modify application packaging to match new server requirements. "
            description += "(5) Update deployment scripts and automation tools. "
            description += "(6) Test application deployment and startup procedures. "
            description += "(7) Validate all endpoints, session management, and security configurations. "
            # description += f"CRITICAL: Test load balancing, clustering, and failover with {component_name} {target}."

        elif 'Middleware' in category:
            description += f"(1) Update middleware connection configurations for {component_name} {target}. "
            description += "(2) Review and update message formats, routing rules, and transformation logic. "
            description += "(3) Update client libraries and SDKs to versions compatible with new middleware. "
            description += "(4) Modify integration endpoints and service bindings. "
            description += "(5) Test all message flows, including error handling and retry logic. "
            description += "(6) Validate performance under expected load and peak conditions. "
            description += "(7) Verify monitoring, logging, and alerting integrations. "
            description += f"CRITICAL: Ensure backward compatibility with systems still using older {component_name} versions."

        elif 'Operating' in category:
            description += f"(1) Provision new environment with {component_name} {target}. "
            description += "(2) Install all required system packages and dependencies for target OS. "
            description += "(3) Migrate system configurations, environment variables, and service definitions. "
            description += "(4) Update application startup scripts and systemd/init configurations. "
            description += "(5) Test all applications for OS-level compatibility. "
            description += "(6) Validate file system permissions, network configurations, and security policies. "
            description += "(7) Verify backup, monitoring, and logging agents work with new OS. "
            description += f"CRITICAL: Plan maintenance window and ensure rollback procedures are tested."

        else:
            description += f"(1) Review {component_name} upgrade documentation from version {current} to {target}. "
            description += "(2) Identify all breaking changes, deprecated features, and new requirements. "
            description += "(3) Update application code, configurations, and dependencies accordingly. "
            description += "(4) Test upgrade in non-production environment with production-like data. "
            description += "(5) Validate all functionality and performance metrics. "
            description += "(6) Document any issues encountered and their resolutions. "
            description += f"CRITICAL: Ensure rollback plan is ready before production deployment."

    elif num_upgrades == 2:
        description += "(1) Create compatibility matrix between the two components to identify dependencies. "
        description += "(2) Determine optimal upgrade sequence based on dependencies and risk. "
        description += "(3) Upgrade first component in isolated test environment. "
        description += "(4) Validate first component upgrade with comprehensive testing. "
        description += "(5) Upgrade second component while maintaining first component at new version. "
        description += "(6) Test both components together for integration issues. "
        description += "(7) Validate end-to-end application functionality with both upgrades. "
        description += "(8) Document any compatibility issues and their resolutions. "
        description += "CRITICAL: Prepare rollback procedures for each component independently and together."

    elif num_upgrades <= 5:
        description += "(1) Build comprehensive compatibility matrix for all components. "
        description += "(2) Identify dependencies and group components into logical upgrade batches. "
        description += "(3) Sequence batches to minimize risk and maintain application stability. "
        description += "(4) For each batch: upgrade components, test individually, then test batch integration. "
        description += "(5) After each batch: validate application functionality before proceeding. "
        description += "(6) Document issues, resolutions, and lessons learned from each batch. "
        description += "(7) Execute final integration testing with all components at target versions. "
        description += "(8) Perform load testing and performance validation. "
        description += "CRITICAL: Use staged deployment through dev → staging → production with validation gates."

    else:
        description += "(1) PLANNING PHASE: Create detailed compatibility matrix for all components. "
        description += "(2) Identify all dependencies, conflicts, and upgrade prerequisites. "
        description += "(3) Group components into 3-5 logical batches based on dependencies and risk. "
        description += "(4) Create detailed runbook for each batch with rollback procedures. "
        description += "(5) EXECUTION PHASE: Upgrade components batch by batch over multiple sprints. "
        description += "(6) For each batch: test in isolation, then integration test with previous batches. "
        description += "(7) Maintain detailed log of issues, resolutions, and configuration changes. "
        description += "(8) VALIDATION PHASE: Execute comprehensive end-to-end testing. "
        description += "(9) Perform load testing, security scanning, and performance benchmarking. "
        description += "(10) Conduct user acceptance testing before production deployment. "
        description += "CRITICAL: This complex migration requires dedicated team, automated testing, and 8-12 week timeline. Consider engaging migration specialists."

    return description


def _shorten_component_name(name: str) -> str:
    """Shorten component name for display."""
    shortenings = {
        'WebSphere Application Server': 'WebSphere',
        'HTTP Server': 'HTTP',
        'Tomcat': 'Tomcat',
        'sendmail': 'sendmail',
        'procmail': 'procmail',
        'Java': 'Java',
        'JDK': 'Java',
        'OpenJDK': 'Java',
        'Oracle Database': 'Oracle',
        'PostgreSQL': 'PostgreSQL',
        'MySQL': 'MySQL'
    }

    for full, short in shortenings.items():
        if full.lower() in name.lower():
            return short

    # Return first word
    return name.split()[0] if ' ' in name else name


def _determine_migration_strategy(upgrades: List[Dict[str, Any]]) -> str:
    """
    Determine migration strategy based on upgrade categories.

    Strategies:
    - OS Upgrade
    - Runtime Upgrade
    - Database Upgrade
    - Middleware Upgrade
    - Full Stack Upgrade
    - Security Patch Only
    - Minor Version Upgrade
    - Major Version Upgrade
    - Mixed Upgrade

    Args:
        upgrades: List of upgrade dictionaries

    Returns:
        Migration strategy name
    """
    if not upgrades:
        return "None"

    # Categorize upgrades
    categories_found = set()
    for upgrade in upgrades:
        category = upgrade.get('category', '').lower()

        if 'operating' in category or 'os' in category:
            categories_found.add('OS')
        elif 'runtime' in category or 'language' in category:
            categories_found.add('Runtime')
        elif 'database' in category:
            categories_found.add('Database')
        elif 'middleware' in category or 'server' in category:
            categories_found.add('Middleware')
        elif 'web' in category:
            categories_found.add('Web Server')
        elif 'framework' in category:
            categories_found.add('Framework')

    # Determine strategy
    if len(categories_found) == 0:
        return "Mixed Upgrade"
    elif len(categories_found) == 1:
        category = list(categories_found)[0]
        # Check if major or minor
        is_major = _is_major_version_upgrade(upgrades)
        if is_major:
            return f"{category} Major Upgrade"
        else:
            return f"{category} Minor Upgrade"
    elif len(categories_found) >= 3:
        return "Full Stack Upgrade"
    else:
        return " + ".join(sorted(categories_found)) + " Upgrade"


def _is_major_version_upgrade(upgrades: List[Dict[str, Any]]) -> bool:
    """Check if any upgrade is a major version change."""
    for upgrade in upgrades:
        current = upgrade.get('current_version', '')
        target = upgrade.get('target_version', '')

        try:
            # Extract major version numbers
            current_major = int(current.split('.')[0]) if '.' in current else int(current.split()[0])
            target_major = int(target.split('.')[0]) if '.' in target else int(target.split()[0])

            if target_major > current_major:
                return True
        except (ValueError, IndexError):
            continue

    return False


def _load_existing_patterns(wave_id: str) -> List[Dict[str, Any]]:
    """
    Load existing patterns from wave_patterns DynamoDB table.

    Retrieves all pattern-application mappings for the given wave to enable
    pattern reuse across applications with similar component transformations.

    Args:
        wave_id: Wave identifier

    Returns:
        List of existing pattern dictionaries with:
        - pattern_id: Unique pattern identifier
        - application_id: Application that created this pattern
        - pattern_signature: Component transformation signature
        - atx_name: ATX mapping (if assigned)
        - wave_id: Wave identifier
    """
    try:
        # Get wave_patterns table
        wave_patterns_table_name = Config.PATTERNS_TABLE
        wave_patterns_table = dynamodb.Table(wave_patterns_table_name)

        # Query by wave_id using GSI
        from boto3.dynamodb.conditions import Key

        response = wave_patterns_table.query(
            IndexName='wave_id_index',
            KeyConditionExpression=Key('wave_id').eq(wave_id)
        )

        items = response.get('Items', [])

        # Build pattern dictionary keyed by pattern_id
        # Keep only the first occurrence of each pattern_id (the original application)
        patterns_dict = {}
        for item in items:
            pattern_id = item.get('pattern_id')
            if pattern_id and pattern_id not in patterns_dict:
                # Extract pattern signature from transformation_instructions
                # The signature is embedded in the instructions
                patterns_dict[pattern_id] = {
                    'pattern_id': pattern_id,
                    'application_id': item.get('application_id'),
                    'application_name': item.get('application_name'),
                    'pattern_signature': item.get('transformation_instructions', ''),
                    'atx_name': item.get('atx_name'),
                    'wave_id': item.get('wave_id')
                }

        patterns_list = list(patterns_dict.values())
        logger.info(f"Loaded {len(patterns_list)} unique patterns from wave_patterns table for wave {wave_id}")

        return patterns_list

    except Exception as e:
        logger.error(f"Error loading existing patterns from wave_patterns table: {str(e)}")
        import traceback
        traceback.print_exc()
        return []


def _find_matching_pattern(
    pattern_signature: str,
    existing_patterns: List[Dict[str, Any]],
    similarity_threshold: int
) -> Dict[str, Any] | None:
    """
    Find matching pattern from existing patterns using similarity threshold.

    Compares the new pattern signature against existing patterns using
    Jaccard similarity on component transformations. Returns the first
    pattern that meets or exceeds the similarity threshold.

    Similarity Algorithm:
    - Extracts component transformations (e.g., "Java 8→11", "PostgreSQL 9→14")
    - Calculates Jaccard similarity: |intersection| / |union|
    - Returns match if similarity >= threshold

    Args:
        pattern_signature: New pattern signature to match
        existing_patterns: List of existing patterns from wave_patterns table
        similarity_threshold: Percentage threshold (0-100) for matching

    Returns:
        Matching pattern dictionary or None if no match found
    """
    if not existing_patterns or not pattern_signature:
        return None

    # Parse new pattern signature into component transformations
    new_components = _parse_pattern_signature(pattern_signature)

    if not new_components:
        return None

    best_match = None
    best_similarity = 0.0

    # Compare against each existing pattern
    for existing_pattern in existing_patterns:
        existing_signature = existing_pattern.get('pattern_signature', '')
        existing_components = _parse_pattern_signature(existing_signature)

        if not existing_components:
            continue

        # Calculate Jaccard similarity
        similarity = _calculate_jaccard_similarity(new_components, existing_components)
        similarity_percentage = similarity * 100

        logger.debug(f"Comparing with pattern {existing_pattern['pattern_id']}: {similarity_percentage:.1f}% similarity")

        # Check if this is the best match so far
        if similarity_percentage >= similarity_threshold and similarity_percentage > best_similarity:
            best_similarity = similarity_percentage
            best_match = existing_pattern

    if best_match:
        logger.info(f"Found matching pattern {best_match['pattern_id']} with {best_similarity:.1f}% similarity (threshold: {similarity_threshold}%)")

    return best_match


def _parse_pattern_signature(signature: str) -> set:
    """
    Parse pattern signature into set of component transformations.

    Extracts component upgrade patterns from signature string.
    Example: "Java 8→11, PostgreSQL 9→14" -> {"java 8→11", "postgresql 9→14"}

    Args:
        signature: Pattern signature string

    Returns:
        Set of normalized component transformation strings
    """
    if not signature:
        return set()

    components = set()

    # Split by comma and extract component transformations
    parts = signature.split(',')
    for part in parts:
        part = part.strip()

        # Look for version transformation pattern (→ or ->)
        if '→' in part or '->' in part:
            # Normalize the arrow
            normalized = part.replace('->', '→')
            # Extract just the component and versions (remove extra text)
            # Example: "Java 8→11" or "PostgreSQL 9.6→14.2"
            components.add(normalized.lower())

    return components


def _calculate_jaccard_similarity(set1: set, set2: set) -> float:
    """
    Calculate Jaccard similarity between two sets.

    Jaccard similarity = |intersection| / |union|

    Args:
        set1: First set
        set2: Second set

    Returns:
        Similarity score between 0.0 and 1.0
    """
    if not set1 or not set2:
        return 0.0

    intersection = set1.intersection(set2)
    union = set1.union(set2)

    if not union:
        return 0.0

    return len(intersection) / len(union)
