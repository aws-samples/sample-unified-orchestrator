"""FastAPI dependency injection providers."""
from typing import Generator
from functools import lru_cache

from app.services.risk_service import RiskService
from app.services.pattern_service import PatternService
from app.services.application_status_service import ApplicationStatusService
from app.repositories.application_repository import ApplicationRepository
from app.repositories.risk_assessment_repository import RiskAssessmentRepository
from app.repositories.app_component_repository import AppComponentRepository
from app.repositories.target_component_repository import TargetComponentRepository
from app.config import Config


# Application-scoped singletons (cached)

@lru_cache()
def get_risk_service() -> RiskService:
    """Get RiskService singleton."""
    return RiskService()


@lru_cache()
def get_pattern_service() -> PatternService:
    """Get PatternService singleton."""
    return PatternService()


@lru_cache()
def get_application_status_service() -> ApplicationStatusService:
    """Get ApplicationStatusService singleton."""
    return ApplicationStatusService()


# Request-scoped dependencies (new instance per request)

def get_application_repository() -> Generator[ApplicationRepository, None, None]:
    """Get ApplicationRepository for request scope."""
    repo = ApplicationRepository()
    try:
        yield repo
    finally:
        # Cleanup if needed
        pass


def get_risk_repository() -> Generator[RiskAssessmentRepository, None, None]:
    """Get RiskAssessmentRepository for request scope."""
    repo = RiskAssessmentRepository()
    try:
        yield repo
    finally:
        # Cleanup if needed
        pass


def get_app_component_repository() -> Generator[AppComponentRepository, None, None]:
    """Get AppComponentRepository for request scope."""
    repo = AppComponentRepository()
    try:
        yield repo
    finally:
        # Cleanup if needed
        pass


def get_target_component_repository() -> Generator[TargetComponentRepository, None, None]:
    """Get TargetComponentRepository for request scope."""
    repo = TargetComponentRepository()
    try:
        yield repo
    finally:
        # Cleanup if needed
        pass


# AWS client providers

def get_dynamodb_client():
    """Get configured DynamoDB client."""
    return Config.get_boto3_client('dynamodb')


def get_s3_client():
    """Get configured S3 client."""
    return Config.get_boto3_client('s3')


def get_bedrock_client():
    """Get configured Bedrock client."""
    from app.utils.bedrock_client import get_bedrock_client as _get_bedrock
    return _get_bedrock()
