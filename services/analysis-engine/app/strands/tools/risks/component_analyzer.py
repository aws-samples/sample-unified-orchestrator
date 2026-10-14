"""
Component Analyzer Tool

Analyzes components and matches them with approved target versions.
Uses an in-memory cache for target components to avoid repeated DynamoDB fetches.
"""

import logging
import time as _time
import threading
from strands import tool
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# ── In-memory target component cache ──────────────────────────────────
# Target components rarely change (only on CSV upload / delete).
# We load them once and reuse across assessments.
_target_cache_lock = threading.Lock()
_target_cache: Dict[str, Any] = {
    'components': [],       # List[TargetComponent]
    'loaded': False,
    'loaded_at': 0.0,
}


def invalidate_target_cache():
    """Call this after target component upload or delete to force a reload."""
    with _target_cache_lock:
        _target_cache['loaded'] = False
        _target_cache['components'] = []
        logger.info("Target component in-memory cache invalidated")


def warm_target_cache():
    """Pre-load target components at startup. Non-blocking — falls back to lazy-load on failure."""
    try:
        _get_cached_target_components()
    except Exception as e:
        logger.warning(f"Startup cache warm failed (will lazy-load on first request): {e}")


def _get_cached_target_components() -> list:
    """Return cached target components, loading from DynamoDB on first call."""
    with _target_cache_lock:
        if _target_cache['loaded']:
            logger.info(f"Target component cache hit: {len(_target_cache['components'])} components")
            return _target_cache['components']

    # Load outside the lock to avoid blocking other threads during the fetch
    from app.repositories.target_component_repository import TargetComponentRepository
    repo = TargetComponentRepository()
    start = _time.time()
    components = repo.get_by_application("ALL")
    elapsed = _time.time() - start
    logger.info(f"Loaded {len(components)} target components from DynamoDB in {elapsed:.2f}s (cold cache)")

    with _target_cache_lock:
        _target_cache['components'] = components
        _target_cache['loaded'] = True
        _target_cache['loaded_at'] = _time.time()

    return components


@tool
def component_analyzer(
    unique_components: List[Dict[str, Any]],
    app_name: str = None,
    dynamodb_client=None
) -> dict:
    """
    Analyze components and match with approved target versions.

    This is a wrapper around the analyze_components functionality that works
    with the retriever output format. Supports batch operations for improved performance.

    Args:
        unique_components: List of unique component dictionaries from retriever
        app_name: Optional application name for better matching
        dynamodb_client: Optional boto3 DynamoDB client for batch operations

    Returns:
        Dictionary containing component analysis results with target version matching
    """
    import time as _time

    logger.info(f"Analyzing {len(unique_components)} components")

    from app.repositories.target_component_repository import TargetComponentRepository

    try:
        # Fetch target components — use in-memory cache for global ("ALL") targets
        target_components = []
        target_lookup = {}
        try:
            fetch_start = _time.time()

            # Global targets from cache (instant after first load)
            global_targets = _get_cached_target_components()

            # App-specific targets (if any) — fetched fresh since they're small
            app_targets = []
            if app_name:
                repo = TargetComponentRepository()
                app_targets = repo._query_all_pages(app_name, projection=True)

            # Combine: app-specific + global
            target_components = app_targets + global_targets

            fetch_time = _time.time() - fetch_start
            logger.info(f"Fetched {len(target_components)} target components in {fetch_time:.2f}s "
                        f"({len(app_targets)} app-specific, {len(global_targets)} global/cached)")

            # Create lookup for exact matching (app-specific takes precedence)
            for tc in reversed(target_components):  # Reverse so app-specific overwrites global
                key = f"{tc.publisher}#{tc.product_key}#{tc.full_version}".lower()
                target_lookup[key] = tc

            logger.info(f"Loaded {len(target_lookup)} unique target components for lookup")
        except Exception as e:
            logger.warning(f"Could not fetch target components (table may not exist): {e}. Proceeding without target matching.")

        # Perform matching with EOSL 2032 awareness
        matched_components = []
        eosl_component_list = []

        # Build lookup dicts for matching
        lookup_start = _time.time()

        # Group target components by normalized publisher and product for EOSL-aware matching
        target_by_product = {}
        # Also build a raw (non-normalized) publisher#product lookup for Strategy 3
        target_by_raw_product = {}
        for tc in target_components:
            normalized_publisher = _normalize_publisher(tc.publisher)
            normalized_product = _normalize_product(tc.product_key)
            key = f"{normalized_publisher}#{normalized_product}".lower()
            if key not in target_by_product:
                target_by_product[key] = []
            target_by_product[key].append(tc)

            # Raw key for Strategy 3 (exact publisher#product, no normalization)
            raw_key = f"{tc.publisher}#{tc.product_key}".lower()
            if raw_key not in target_by_raw_product:
                target_by_raw_product[raw_key] = []
            target_by_raw_product[raw_key].append(tc)

        lookup_time = _time.time() - lookup_start
        logger.info(f"Built lookup dicts in {lookup_time:.2f}s (target_by_product={len(target_by_product)}, target_by_raw_product={len(target_by_raw_product)})")

        match_start = _time.time()
        for comp in unique_components:
            # Check if current component already meets 2032 requirement
            if _component_meets_2032_requirement(comp):
                # Current version is good - no upgrade needed
                comp_detail = _create_component_detail(
                    comp,
                    None,
                    matched=True,
                    keep_current=True,
                    reason="Current version EOSL >= 2032"
                )
                matched_components.append(comp_detail)
                continue

            # Try multiple matching strategies
            target_comp = None
            exact_match_comp = None

            # Strategy 1: Exact match - publisher#product#version
            match_key = f"{comp['publisher']}#{comp['product']}#{comp['full_version']}".lower()
            exact_match_comp = target_lookup.get(match_key)

            # Strategy 2: If no match, try with publisher prepended to product
            if not exact_match_comp:
                match_key_alt = f"{comp['publisher']}#{comp['publisher']} {comp['product']}#{comp['full_version']}".lower()
                exact_match_comp = target_lookup.get(match_key_alt)

            # Check if exact match meets 2032 requirement
            if exact_match_comp and _target_meets_2032_requirement(exact_match_comp):
                # Exact match is good - use it
                target_comp = exact_match_comp
            else:
                # Strategy 3: Look for alternative versions of the same product
                # This handles cases where exact match exists but doesn't meet 2032
                # Find all versions of this product (same publisher + product, any version)
                raw_product_key = f"{comp['publisher']}#{comp['product']}".lower()
                product_versions = target_by_raw_product.get(raw_product_key, [])

                if product_versions:
                    # Find best version that meets 2032
                    best_target = _find_best_target_version(product_versions)
                    if best_target:
                        target_comp = best_target
                    else:
                        # No version meets 2032, find closest
                        target_comp = _find_closest_to_2032(product_versions)
                else:
                    # Strategy 4: Normalized matching with EOSL 2032 awareness
                    # This handles cases where product names differ slightly
                    normalized_publisher = _normalize_publisher(comp['publisher'])
                    normalized_product = _normalize_product(comp['product'])
                    product_key = f"{normalized_publisher}#{normalized_product}".lower()
                    available_targets = target_by_product.get(product_key, [])

                    if available_targets:
                        # Find best target version (EOSL >= 2032, prefer latest)
                        best_target = _find_best_target_version(available_targets)
                        if best_target:
                            target_comp = best_target
                        else:
                            # No version meets 2032, find closest
                            target_comp = _find_closest_to_2032(available_targets)

            # Build component detail with EOSL 2032 awareness
            if target_comp:
                warning = None
                if target_comp.end_of_support_date:
                    try:
                        from datetime import datetime
                        eosl_date = datetime.strptime(target_comp.end_of_support_date, '%Y-%m-%d')
                        if eosl_date < datetime(2032, 1, 1):
                            warning = "Target version EOSL < 2032"
                    except:
                        pass

                comp_detail = _create_component_detail(comp, target_comp, matched=True, warning=warning)
            else:
                comp_detail = _create_component_detail(comp, None, matched=False)

            matched_components.append(comp_detail)

            # Track EOSL components
            # Check both string '4' and int 4 for robustness
            if str(comp.get('eosl_status', '')) == '4':
                eosl_component_list.append({
                    'publisher': comp.get('publisher'),
                    'product': comp.get('product'),
                    'current_version': comp.get('full_version'),
                    'eosl_date': comp.get('eosl_date'),
                    'target_version': comp_detail['target_version']
                })

        # Calculate metrics
        match_time = _time.time() - match_start
        logger.info(f"Matching loop completed in {match_time:.2f}s for {len(unique_components)} components")

        total_count = len(matched_components)
        matched_count = sum(1 for c in matched_components if c['matched'])
        coverage_percentage = round((matched_count / total_count * 100), 2) if total_count > 0 else 0

        # Count EOSL components
        eosl_count = len(eosl_component_list)

        logger.info(f"Component analysis complete: {matched_count}/{total_count} matched ({coverage_percentage}%), {eosl_count} EOSL")

        return {
            'total_components': total_count,
            'matched_components': matched_count,
            'unmatched_components': total_count - matched_count,
            'eosl_components': eosl_count,
            'coverage_percentage': coverage_percentage,
            'components': matched_components,
            'eosl_component_list': eosl_component_list,
            'target_version_coverage': coverage_percentage
        }

    except Exception as e:
        logger.error(f"Error analyzing components: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'total_components': len(unique_components),
            'matched_components': 0,
            'unmatched_components': len(unique_components),
            'eosl_components': 0,
            'coverage_percentage': 0,
            'components': unique_components,
            'eosl_component_list': [],
            'error': str(e)
        }



def _normalize_publisher(publisher):
    """Normalize publisher names for better matching."""
    publisher_lower = publisher.lower().strip()

    # Rocky/CentOS/Red Hat are related (RHEL ecosystem)
    if any(x in publisher_lower for x in ['rocky', 'centos', 'red hat', 'redhat']):
        return 'Red Hat'

    # Python publishers
    if 'python' in publisher_lower and 'foundation' in publisher_lower:
        return 'Python Software Foundation'

    # Return original if no normalization needed
    return publisher


def _normalize_product(product):
    """Normalize product names for better matching."""
    product_lower = product.lower().strip()

    # Remove publisher prefix from product name (e.g., "Oracle Java" → "Java")
    # This handles cases where target has "Oracle Oracle Java" or "Red Hat Red Hat Python"
    common_publishers = ['oracle', 'red hat', 'microsoft', 'canonical', 'ibm', 'dell', 'hp', 'hpe']
    for pub in common_publishers:
        if product_lower.startswith(pub + ' '):
            product_lower = product_lower[len(pub)+1:]
            break

    # Python product normalization - be specific to avoid matching python libraries
    if product_lower == 'python' or product_lower == 'rh-python':
        return 'python'
    elif 'red hat python' in product_lower and '-' not in product_lower:
        return 'python'

    # Python libraries - normalize to just the library name
    if 'python-' in product_lower:
        parts = product_lower.split('python-')
        if len(parts) > 1:
            return f"python-{parts[-1]}"

    # GCC compiler
    if product_lower == 'gcc' or 'red hat gcc' in product_lower:
        return 'gcc'

    # Buildah
    if 'buildah' in product_lower:
        return 'buildah'

    # curl
    if product_lower == 'curl' or product_lower.startswith('curl '):
        return 'curl'

    # Return normalized (publisher prefix removed)
    return product_lower


def _component_meets_2032_requirement(comp):
    """Check if component's current EOSL date meets 2032 requirement."""
    from datetime import datetime

    eosl_date = comp.get('eosl_date')
    if not eosl_date:
        return False

    try:
        # Parse EOSL date (format: YYYY-MM-DD)
        eosl_date_obj = datetime.strptime(eosl_date, '%Y-%m-%d')
        target_date = datetime(2032, 1, 1)
        return eosl_date_obj >= target_date
    except:
        return False


def _target_meets_2032_requirement(target_comp):
    """Check if target component's EOSL date meets 2032 requirement."""
    from datetime import datetime

    eosl_date = target_comp.end_of_support_date
    if not eosl_date:
        return False

    try:
        # Parse EOSL date (format: YYYY-MM-DD)
        eosl_date_obj = datetime.strptime(eosl_date, '%Y-%m-%d')
        target_date = datetime(2032, 1, 1)
        return eosl_date_obj >= target_date
    except:
        return False


def _find_best_target_version(target_components):
    """Find the best target version with EOSL >= 2032, prefer latest version."""
    from datetime import datetime

    target_date = datetime(2032, 1, 1)
    compliant_versions = []

    for tc in target_components:
        if not tc.end_of_support_date:
            continue

        try:
            eosl_date = datetime.strptime(tc.end_of_support_date, '%Y-%m-%d')
            if eosl_date >= target_date:
                compliant_versions.append((tc, eosl_date))
        except:
            continue

    if not compliant_versions:
        return None

    # Sort by EOSL date (descending) to get the latest supported version
    compliant_versions.sort(key=lambda x: x[1], reverse=True)
    return compliant_versions[0][0]


def _find_closest_to_2032(target_components):
    """Find target version with EOSL closest to 2032 (even if before)."""
    from datetime import datetime

    target_date = datetime(2032, 1, 1)
    closest_version = None
    min_diff = None

    for tc in target_components:
        if not tc.end_of_support_date:
            continue

        try:
            eosl_date = datetime.strptime(tc.end_of_support_date, '%Y-%m-%d')
            diff = abs((eosl_date - target_date).days)

            if min_diff is None or diff < min_diff:
                min_diff = diff
                closest_version = tc
        except:
            continue

    return closest_version if closest_version else (target_components[0] if target_components else None)


def _create_component_detail(comp, target_comp, matched, keep_current=False, warning=None, reason=None):
    """Create component detail dictionary with all fields populated."""
    if keep_current:
        # Current version meets 2032 requirement - no upgrade needed
        return {
            **comp,
            'matched': True,
            'target_version': comp.get('full_version'),  # Same as current
            'target_edition': 'Current version',
            'target_software_title': comp.get('product'),
            'target_eol_date': comp.get('eosl_date'),
            'target_eosl_date': comp.get('eosl_date'),
            'keep_current': True,
            'recommendation': reason or 'Current version EOSL >= 2032 - no upgrade needed'
        }

    return {
        **comp,
        'matched': matched,
        'target_version': target_comp.full_version if target_comp else 'Not Available',
        'target_edition': target_comp.edition if target_comp else 'Not Available',
        'target_software_title': target_comp.software_title if target_comp else 'Not Available',
        'target_eol_date': target_comp.end_of_life_date if target_comp else 'Not Available',
        'target_eosl_date': target_comp.end_of_support_date if target_comp else 'Not Available',
        'warning': warning,
        'keep_current': False
    }
