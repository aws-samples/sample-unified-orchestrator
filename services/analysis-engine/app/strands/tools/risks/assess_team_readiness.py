"""
Assess Team Readiness Tool

This tool evaluates the team's readiness for application migration
based on availability, skills, knowledge transfer, and training.
"""

import logging
from strands import tool

logger = logging.getLogger(__name__)


@tool
def assess_team_readiness(team_availability: str, skill_level: str, knowledge_transfer: str, training_completed: str) -> dict:
    """
    Assess team readiness for application migration based on human resource factors.

    Use this tool to evaluate if the team is ready to execute the migration.
    The team readiness score uses a weighted formula:
    - Team availability (30% weight): Dedicated vs part-time resources
    - Skill level (30% weight): Team expertise with target technologies
    - Knowledge transfer (25% weight): Documentation and knowledge sharing status
    - Training completed (15% weight): Completion of required training programs

    Valid input values:
    - team_availability: "Dedicated" (100), "Part-time" (50), "None" (0)
    - skill_level: "Expert" (100), "Some experience" (50), "No experience" (0)
    - knowledge_transfer: "Full docs + devs" (100), "Key person" (75), "Docs only" (50), "None" (0)
    - training_completed: "All trained" (100), "Some trained" (50), "No training" (0)

    Example response:
        {
            "team_readiness_score": 75,
            "factors": {
                "team_availability": 100,
                "skill_level": 50,
                "knowledge_transfer": 75,
                "training_completed": 100
            },
            "recommendations": ["Consider additional training for target platform"]
        }

    Args:
        team_availability: Team resource availability level
        skill_level: Team skill and expertise level
        knowledge_transfer: Knowledge transfer and documentation status
        training_completed: Training completion status

    Returns:
        Dictionary containing team readiness score, factor breakdown, and recommendations
    """
    logger.info("Assessing team readiness")

    # Calculate individual factor scores
    availability_score = _calculate_availability_score(team_availability)
    skill_score = _calculate_skill_score(skill_level)
    knowledge_score = _calculate_knowledge_score(knowledge_transfer)
    training_score = _calculate_training_score(training_completed)

    # Calculate weighted team readiness score
    team_readiness_score = (
        availability_score * 0.30 +
        skill_score * 0.30 +
        knowledge_score * 0.25 +
        training_score * 0.15
    )

    # Generate recommendations
    recommendations = _generate_team_recommendations(
        availability_score, skill_score, knowledge_score, training_score
    )

    return {
        'team_readiness_score': round(team_readiness_score, 2),
        'factors': {
            'team_availability': round(availability_score, 2),
            'skill_level': round(skill_score, 2),
            'knowledge_transfer': round(knowledge_score, 2),
            'training_completed': round(training_score, 2)
        },
        'recommendations': recommendations
    }


def _calculate_availability_score(team_availability: str) -> float:
    """Calculate team availability score."""
    availability_lower = team_availability.lower()

    availability_map = {
        'dedicated': 100,
        'full-time': 100,
        'fulltime': 100,
        'part-time': 50,
        'parttime': 50,
        'part_time': 50,
        'none': 0,
        'no_team': 0
    }

    return availability_map.get(availability_lower, 0)


def _calculate_skill_score(skill_level: str) -> float:
    """Calculate skill level score."""
    skill_lower = skill_level.lower()

    skill_map = {
        'expert': 100,
        'advanced': 100,
        'some experience': 50,
        'some_experience': 50,
        'intermediate': 50,
        'beginner': 25,
        'no experience': 0,
        'no_experience': 0,
        'none': 0
    }

    return skill_map.get(skill_lower, 0)


def _calculate_knowledge_score(knowledge_transfer: str) -> float:
    """Calculate knowledge transfer score."""
    knowledge_lower = knowledge_transfer.lower()

    knowledge_map = {
        'full docs + devs': 100,
        'full_docs_devs': 100,
        'complete': 100,
        'key person': 75,
        'key_person': 75,
        'docs only': 50,
        'docs_only': 50,
        'documentation': 50,
        'none': 0,
        'no_knowledge': 0
    }

    return knowledge_map.get(knowledge_lower, 0)


def _calculate_training_score(training_completed: str) -> float:
    """Calculate training completion score."""
    training_lower = training_completed.lower()

    training_map = {
        'all trained': 100,
        'all_trained': 100,
        'complete': 100,
        'some trained': 50,
        'some_trained': 50,
        'partial': 50,
        'no training': 0,
        'no_training': 0,
        'none': 0
    }

    return training_map.get(training_lower, 0)


def _generate_team_recommendations(availability_score: float, skill_score: float,
                                   knowledge_score: float, training_score: float) -> list:
    """Generate recommendations based on team readiness factors."""
    recommendations = []

    if availability_score < 50:
        recommendations.append('Assign dedicated team resources for migration success')

    if skill_score < 50:
        recommendations.append('Consider additional training or hiring experts for target platform')

    if knowledge_score < 50:
        recommendations.append('Improve knowledge transfer - document application and involve original developers')

    if training_score < 50:
        recommendations.append('Complete required training programs before starting migration')

    if not recommendations:
        recommendations.append('Team is well-prepared for migration')

    return recommendations
