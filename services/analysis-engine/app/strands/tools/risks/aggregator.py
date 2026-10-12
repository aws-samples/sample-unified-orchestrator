"""
Aggregator Tool

Aggregates data from all analysis tools and creates comprehensive report.
"""

import logging
from datetime import datetime
from typing import Dict, Any, List
from strands import tool

logger = logging.getLogger(__name__)


@tool
def aggregator(
    retriever_data: Dict[str, Any],
    component_analysis: Dict[str, Any],
    scm_analysis: Dict[str, Any] = None,
    team_readiness: Dict[str, Any] = None,
    business_readiness: Dict[str, Any] = None
) -> dict:
    """
    Aggregate all analysis data into comprehensive assessment report.

    Creates a detailed report matching the expected format with:
    - Executive summary
    - Component categories
    - Compatibility analysis
    - EOSL analysis
    - Complexity metrics

    Args:
        retriever_data: Data from retriever tool
        component_analysis: Component analysis results
        scm_analysis: SCM analysis results (optional)
        team_readiness: Team readiness scores (optional)
        business_readiness: Business readiness scores (optional)

    Returns:
        Comprehensive assessment report dictionary
    """
    logger.info("Aggregating assessment data")

    try:
        app_id = retriever_data.get('app_id')
        app_info = retriever_data.get('application_info', {})
        components = component_analysis.get('components', [])

        # Group components by category
        categories = _group_by_category(components)

        # Calculate risk distribution
        risk_distribution = _calculate_risk_distribution(components)

        # Calculate complexity metrics (now uses SCM analysis for 5-factor scoring)
        complexity_metrics = _calculate_complexity_metrics(components, retriever_data, scm_analysis)

        # Calculate migration readiness score
        migration_readiness_score = _calculate_migration_readiness(
            component_analysis,
            scm_analysis,
            team_readiness,
            business_readiness
        )

        # Generate key recommendations
        key_recommendations = _generate_recommendations(
            component_analysis,
            risk_distribution,
            complexity_metrics
        )

        # Build executive summary
        executive_summary = {
            'total_components': component_analysis.get('total_components', 0),
            'categories_analyzed': len(categories),
            'target_versions_found': component_analysis.get('matched_components', 0),
            'target_version_coverage': component_analysis.get('coverage_percentage', 0),
            'risk_distribution': risk_distribution,
            'high_risk_components': risk_distribution.get('High', 0),
            'eosl_violations': component_analysis.get('eosl_components', 0),
            'migration_readiness_score': migration_readiness_score,
            'key_recommendations': key_recommendations,
            'machine_count': retriever_data.get('machine_count', 0),
            'repo_count': retriever_data.get('repo_count', 0),
        }

        # Build final report (matching expected format)
        report = {
            'analysis_timestamp': datetime.now().isoformat(),
            'application_ids': [app_id],
            'assessment_number': 1,
            'executive_summary': executive_summary,
            'categories': categories,
            'complexity_metrics': complexity_metrics,
            'scm_analysis': scm_analysis or {},
            'team_readiness': team_readiness or {},
            'business_readiness': business_readiness or {},
            'component_analysis': {
                'total_components': component_analysis.get('total_components', 0),
                'matched_components': component_analysis.get('matched_components', 0),
                'unmatched_components': component_analysis.get('unmatched_components', 0),
                'eosl_components': component_analysis.get('eosl_components', 0),
                'coverage_percentage': component_analysis.get('coverage_percentage', 0),
                'eosl_component_list': component_analysis.get('eosl_component_list', []),
                'components': components  # Include full component details with EOSL data
            }
        }

        logger.info(f"Aggregation complete for application {app_id}")
        return report

    except Exception as e:
        logger.error(f"Error aggregating data: {str(e)}")
        return {
            'error': str(e),
            'analysis_timestamp': datetime.now().isoformat(),
            'application_ids': [retriever_data.get('app_id', 'unknown')],
        }


def _group_by_category(components: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group components by category."""
    categories = {
        'operating_systems': [],
        'middleware': [],
        'databases': [],
        'programming_languages': [],
        'runtime_environments': [],
        'utilities': [],
        'security': [],
        'it_management': [],
        'storage_management': [],
        'multimedia_graphics': [],
        'productivity': [],
        'configuration_management': [],
        'virtualization': [],
        'business_intelligence': [],
        'collaboration': [],
        'engineering_scientific': [],
        'gis': [],
        'ecm': [],
        'other': []
    }

    category_mapping = {
        # Original mappings
        'Operating Systems': 'operating_systems',
        'Middleware': 'middleware',
        'Application Servers': 'middleware',
        'Database Management Systems (DBMS)': 'databases',
        'Relational Database': 'databases',
        'NoSQL Database': 'databases',
        'Programming Language': 'programming_languages',
        'Runtime Environment': 'runtime_environments',
        'Software Development': 'programming_languages',
        # New mappings for previously unmapped categories
        'Utilities': 'utilities',
        'Security': 'security',
        'IT Management': 'it_management',
        'Storage Management': 'storage_management',
        'Multimedia & Graphics': 'multimedia_graphics',
        'Productivity': 'productivity',
        'Configuration Management': 'configuration_management',
        'Virtualization': 'virtualization',
        'Business Intelligence (BI)': 'business_intelligence',
        'Collaboration': 'collaboration',
        'Engineering & Scientific': 'engineering_scientific',
        'Geographic Information Systems (GIS)': 'gis',
        'Enterprise Content Management (ECM)': 'ecm',
    }

    for comp in components:
        category = comp.get('category', '')
        sub_category = comp.get('subcategory', comp.get('sub_category', ''))

        # Determine category group (check subcategory first, then category)
        category_key = category_mapping.get(sub_category) or category_mapping.get(category)

        if not category_key:
            # Put unmapped components in 'other' category instead of skipping
            category_key = 'other'

        # Build target_version structure matching expected format
        target_version_data = None
        if comp.get('matched', False) and comp.get('target_version') != 'Not Available':
            target_version_data = {
                'product_key': f"{comp.get('publisher')} {comp.get('product')}",
                'version': comp.get('target_version'),
                'eosl': comp.get('target_eosl_date', 'User Defined'),
                'found': True,
                'within_eosl': True,
                'distance': None
            }

        # Add compatibility and EOSL analysis
        comp_with_analysis = {
            **comp,
            'target_version': target_version_data,
            'compatibility_analysis': _analyze_compatibility(comp),
            'eosl_analysis': _analyze_eosl(comp)
        }

        categories[category_key].append(comp_with_analysis)

    # Remove empty categories
    return {k: v for k, v in categories.items() if v}


def _analyze_compatibility(component: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze component compatibility."""
    current_version = component.get('full_version', '')
    matched = component.get('matched', False)
    target_version = component.get('target_version', 'Not Available')

    # If target_version is a dict (from our new structure), extract the version
    if isinstance(target_version, dict):
        target_version = target_version.get('version', 'Not Found')
    elif target_version == 'Not Available':
        target_version = 'Not Found'

    if not matched or target_version == 'Not Found':
        return {
            'component': component.get('product'),
            'publisher': component.get('publisher', component.get('software_publisher')),
            'current_version': current_version,
            'target_version': 'Not Found',
            'is_compatible': False,
            'compatibility_issues': [{
                'component_name': component.get('product'),
                'current_version': current_version,
                'target_version': 'Not Found',
                'risk_level': 'High',
                'issue_type': 'Version Gap',
                'description': 'No target version found for this component',
                'specific_details': f"No corresponding target version found for {component.get('product')}",
                'required_patches': [],
                'recommendations': [
                    'Manual research required',
                    'Contact vendor for upgrade path'
                ]
            }],
            'risk_score': 75,
            'overall_risk_level': 'High'
        }

    return {
        'component': component.get('product'),
        'publisher': component.get('publisher', component.get('software_publisher')),
        'current_version': current_version,
        'target_version': target_version,
        'is_compatible': True,
        'compatibility_issues': [],
        'risk_score': 0,
        'overall_risk_level': 'Low'
    }


def _analyze_eosl(component: Dict[str, Any]) -> Dict[str, Any] | None:
    """Analyze EOSL status."""
    eosl_status = component.get('eosl_status', '5')

    if eosl_status == '4':  # End of Life
        return {
            'is_eosl': True,
            'eosl_date': component.get('eosl_date', 'Unknown'),
            'risk_level': 'Critical',
            'recommendation': 'Immediate upgrade required'
        }
    elif eosl_status == '2':  # Approaching EOL
        return {
            'is_eosl': False,
            'eosl_date': component.get('eosl_date', 'Unknown'),
            'risk_level': 'Medium',
            'recommendation': 'Plan upgrade within 6 months'
        }

    return None


def _calculate_risk_distribution(components: List[Dict[str, Any]]) -> Dict[str, int]:
    """Calculate risk distribution across components."""
    distribution = {
        'Critical': 0,
        'High': 0,
        'Medium': 0,
        'Low': 0,
        'Unknown': 0
    }

    for comp in components:
        if not comp.get('matched', False):
            distribution['High'] += 1
        elif comp.get('eosl_status') == '4':
            distribution['Critical'] += 1
        elif comp.get('eosl_status') == '2':
            distribution['Medium'] += 1
        else:
            distribution['Low'] += 1

    return distribution


def _calculate_complexity_metrics(components: List[Dict[str, Any]], retriever_data: Dict[str, Any], scm_analysis: Dict[str, Any] = None) -> Dict[str, Any]:
    """Calculate complexity using 6 weighted factors.

    When no SCM analysis is available (no repo URL), SCM-derived scores default to 0.
    Machine count comes from the retriever (discovery data).

    Factors:
    1. Integration Count (25%)
    2. Version Gaps (20%)
    3. Application Type (15%)
    4. Testing Maturity (10%)
    5. Data Migration Size (10%)
    6. Machine Count (20%) — number of unique machines running the app
    """
    scm = scm_analysis or {}
    has_scm_data = bool(scm.get('source_code_repos')) or scm.get('source_code_score', 0) > 0

    # Factor 1: Integration Count (25%)
    integration_count = scm.get('integration_count', 0)
    if not has_scm_data:
        integration_score = 0
    elif integration_count <= 5:
        integration_score = 10
    elif integration_count <= 15:
        integration_score = 30
    elif integration_count <= 30:
        integration_score = 60
    else:
        integration_score = 100

    # Factor 2: Version Gaps (20%)
    version_gap_score = 0

    # Factor 3: Application Type (15%)
    app_type = scm.get('application_type', 'Unknown')
    app_type_scores = {
        'REST API': 10, 'Stateless API': 10,
        'Web Application': 25, 'Stateful Web': 25,
        'Event-Driven': 40, 'Socket-Based': 60,
        'Containerized': 30,
        'Legacy': 80, 'Mainframe': 100,
    }
    app_type_details = scm.get('application_type_details', [])
    if not has_scm_data:
        application_type_score = 0
    elif app_type_details:
        application_type_score = max(d.get('score', 0) for d in app_type_details)
    else:
        application_type_score = app_type_scores.get(app_type, 0)

    # Factor 4: Testing Maturity (10%)
    testing = scm.get('testing_maturity', 'Unknown')
    testing_scores = {
        'Full Pyramid': 25, 'Unit + Integration': 50,
        'Unit Only': 75, 'No Tests': 100,
    }
    if not has_scm_data:
        testing_maturity_score = 0
    else:
        testing_maturity_score = testing_scores.get(testing, 0)

    # Factor 5: Data Migration Size (10%)
    if not has_scm_data:
        data_migration_size_score = 0
    else:
        data_migration_size_score = 25

    # Factor 6: Machine Count (20%)
    machine_count = retriever_data.get('machine_count', 0)
    if machine_count == 0:
        machine_count_score = 0
    elif machine_count <= 3:
        machine_count_score = 15
    elif machine_count <= 10:
        machine_count_score = 40
    elif machine_count <= 20:
        machine_count_score = 70
    else:
        machine_count_score = 100

    # Weighted total
    complexity_score = (
        integration_score * 0.25 +
        version_gap_score * 0.20 +
        application_type_score * 0.15 +
        testing_maturity_score * 0.10 +
        data_migration_size_score * 0.10 +
        machine_count_score * 0.20
    )

    if complexity_score < 30:
        complexity_level = 'Low'
    elif complexity_score < 60:
        complexity_level = 'Medium'
    else:
        complexity_level = 'High'

    return {
        'complexity_score': round(complexity_score),
        'complexity_level': complexity_level,
        'metrics': {
            'integration_score': integration_score,
            'integration_count': integration_count,
            'integrations': scm.get('integrations', []),
            'integrations_by_type': scm.get('integrations_by_type', {}),
            'version_gap_score': version_gap_score,
            'application_type_score': application_type_score,
            'application_type': app_type,
            'application_type_label': scm.get('application_type_label', app_type),
            'application_type_framework': scm.get('application_type_framework', 'Unknown'),
            'application_type_details': scm.get('application_type_details', []),
            'testing_maturity_score': testing_maturity_score,
            'testing_maturity': testing,
            'testing_details': scm.get('testing_details', []),
            'testing_frameworks': scm.get('testing_frameworks', []),
            'testing_estimated_coverage': scm.get('testing_estimated_coverage', 0),
            'data_migration_size_score': data_migration_size_score,
            'data_migration_size': 'Unknown',
            'machine_count_score': machine_count_score,
            'machine_count': machine_count,
        },
    }


def _calculate_migration_readiness(
    component_analysis: Dict[str, Any],
    scm_analysis: Dict[str, Any],
    team_readiness: Dict[str, Any],
    business_readiness: Dict[str, Any]
) -> float:
    """Calculate overall migration readiness score using 6 weighted factors.

    Factors (from migration-application-score.md):
    - Source Code (25%): source_code_score from SCM analysis
    - CI/CD (20%): cicd_score from SCM analysis
    - Target Version Coverage (20%): coverage_percentage from component analysis
    - Documentation (15%): documentation_score from SCM analysis
    - Monitoring (10%): monitoring_score from SCM analysis
    - Code Coverage (10%): code_quality_score from SCM analysis
    """
    scm = scm_analysis or {}

    source_code_score = scm.get('source_code_score', 0)
    cicd_score = scm.get('cicd_score', 0)
    target_version_score = component_analysis.get('coverage_percentage', 0)
    documentation_score = scm.get('documentation_score', 0)
    monitoring_score = scm.get('monitoring_score', 0)
    coverage_score = scm.get('code_quality_score', 0)

    readiness = (
        source_code_score * 0.25 +
        cicd_score * 0.20 +
        target_version_score * 0.20 +
        documentation_score * 0.15 +
        monitoring_score * 0.10 +
        coverage_score * 0.10
    )

    return round(readiness, 1)


def _generate_recommendations(
    component_analysis: Dict[str, Any],
    risk_distribution: Dict[str, int],
    complexity_metrics: Dict[str, Any]
) -> List[str]:
    """Generate key recommendations."""
    recommendations = []

    critical_count = risk_distribution.get('Critical', 0)
    high_count = risk_distribution.get('High', 0)
    eosl_count = component_analysis.get('eosl_components', 0)

    recommendations.append(f"Address {critical_count} critical compatibility issues immediately")
    recommendations.append(f"Plan migration strategy for {high_count} high-risk components")
    recommendations.append(f"Resolve {eosl_count} EOSL violations before 2032 deadline")
    recommendations.append(f"Implement comprehensive testing for {high_count} priority components")

    return recommendations
