"""
Assess Business Readiness Tool

This tool evaluates the business readiness for application migration
based on maintenance windows, business calendar, stakeholder alignment, and budget.
"""

import logging
from strands import tool

logger = logging.getLogger(__name__)


@tool
def assess_business_readiness(maintenance_window: str, business_calendar: str,
                              stakeholder_alignment: str, budget_availability: str) -> dict:
    """
    Assess business readiness for application migration based on organizational factors.

    Use this tool to evaluate if the business is ready to support the migration.
    The business readiness score uses an equal weighted formula (25% each):
    - Maintenance window availability: Downtime windows for migration
    - Business calendar alignment: Timing relative to business cycles
    - Stakeholder alignment: Executive and stakeholder support
    - Budget availability: Funding for migration activities

    Valid input values:
    - maintenance_window: "Flexible" (100), "Limited" (50), "No downtime" (0)
    - business_calendar: "Off-peak" (100), "Normal" (50), "Peak season" (0)
    - stakeholder_alignment: "Full buy-in" (100), "Some concerns" (50), "Strong resistance" (0)
    - budget_availability: "Fully funded" (100), "Partial" (50), "No budget" (0)

    Example response:
        {
            "business_readiness_score": 80,
            "factors": {
                "maintenance_window": 100,
                "business_calendar": 100,
                "stakeholder_alignment": 50,
                "budget_availability": 100
            },
            "recommendations": ["Address stakeholder concerns before proceeding"]
        }

    Args:
        maintenance_window: Maintenance window availability
        business_calendar: Business calendar timing
        stakeholder_alignment: Stakeholder support level
        budget_availability: Budget funding status

    Returns:
        Dictionary containing business readiness score, factor breakdown, and recommendations
    """
    logger.info("Assessing business readiness")

    # Calculate individual factor scores (equal weight: 25% each)
    window_score = _calculate_maintenance_window_score(maintenance_window)
    calendar_score = _calculate_business_calendar_score(business_calendar)
    alignment_score = _calculate_stakeholder_alignment_score(stakeholder_alignment)
    budget_score = _calculate_budget_score(budget_availability)

    # Calculate weighted business readiness score (equal weights)
    business_readiness_score = (
        window_score * 0.25 +
        calendar_score * 0.25 +
        alignment_score * 0.25 +
        budget_score * 0.25
    )

    # Generate recommendations
    recommendations = _generate_business_recommendations(
        window_score, calendar_score, alignment_score, budget_score
    )

    return {
        'business_readiness_score': round(business_readiness_score, 2),
        'factors': {
            'maintenance_window': round(window_score, 2),
            'business_calendar': round(calendar_score, 2),
            'stakeholder_alignment': round(alignment_score, 2),
            'budget_availability': round(budget_score, 2)
        },
        'recommendations': recommendations
    }


def _calculate_maintenance_window_score(maintenance_window: str) -> float:
    """Calculate maintenance window availability score."""
    window_lower = maintenance_window.lower()

    window_map = {
        'flexible': 100,
        'available': 100,
        'anytime': 100,
        'limited': 50,
        'restricted': 50,
        'no downtime': 0,
        'no_downtime': 0,
        'none': 0,
        'zero_downtime': 0
    }

    return window_map.get(window_lower, 0)


def _calculate_business_calendar_score(business_calendar: str) -> float:
    """Calculate business calendar alignment score."""
    calendar_lower = business_calendar.lower()

    calendar_map = {
        'off-peak': 100,
        'off_peak': 100,
        'offpeak': 100,
        'low_season': 100,
        'normal': 50,
        'regular': 50,
        'peak season': 0,
        'peak_season': 0,
        'peak': 0,
        'busy_season': 0
    }

    return calendar_map.get(calendar_lower, 0)


def _calculate_stakeholder_alignment_score(stakeholder_alignment: str) -> float:
    """Calculate stakeholder alignment score."""
    alignment_lower = stakeholder_alignment.lower()

    alignment_map = {
        'full buy-in': 100,
        'full_buy_in': 100,
        'full_buyin': 100,
        'strong_support': 100,
        'aligned': 100,
        'some concerns': 50,
        'some_concerns': 50,
        'neutral': 50,
        'moderate': 50,
        'strong resistance': 0,
        'strong_resistance': 0,
        'resistance': 0,
        'opposed': 0
    }

    return alignment_map.get(alignment_lower, 0)


def _calculate_budget_score(budget_availability: str) -> float:
    """Calculate budget availability score."""
    budget_lower = budget_availability.lower()

    budget_map = {
        'fully funded': 100,
        'fully_funded': 100,
        'approved': 100,
        'available': 100,
        'partial': 50,
        'partial_funding': 50,
        'pending': 50,
        'no budget': 0,
        'no_budget': 0,
        'unfunded': 0,
        'not_allocated': 0
    }

    return budget_map.get(budget_lower, 0)


def _generate_business_recommendations(window_score: float, calendar_score: float,
                                       alignment_score: float, budget_score: float) -> list:
    """Generate recommendations based on business readiness factors."""
    recommendations = []

    if window_score < 50:
        recommendations.append('Plan for zero-downtime migration strategy or negotiate maintenance windows')

    if calendar_score < 50:
        recommendations.append('Delay migration until off-peak season to reduce business risk')

    if alignment_score < 50:
        recommendations.append('Address stakeholder concerns and build consensus before proceeding')

    if budget_score < 50:
        recommendations.append('Secure full funding approval before starting migration')

    if not recommendations:
        recommendations.append('Business is ready to support migration')

    return recommendations
