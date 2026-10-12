"""
Application Configuration

Supports both local development (with AWS profiles) and ECS deployment (with task roles).
"""

import os
import json
import logging
import boto3
from typing import Optional
from botocore.config import Config as BotoConfig

logger = logging.getLogger(__name__)


def _get_secret_value(secret_name: str, key: str) -> Optional[str]:
    """Fetch a secret value from AWS Secrets Manager. Returns None on failure."""
    try:
        region = os.environ.get('AWS_REGION', 'us-east-1')
        logger.info(f"Fetching secret '{secret_name}' key='{key}' from region={region}")
        client = boto3.client('secretsmanager', region_name=region)
        response = client.get_secret_value(SecretId=secret_name)
        secret_string = response.get('SecretString', '')
        # Try JSON first (key-value secret)
        try:
            secret_dict = json.loads(secret_string)
            value = secret_dict.get(key)
            if value:
                logger.info(f"Secret '{secret_name}' key='{key}' loaded successfully (len={len(value)})")
            else:
                logger.warning(f"Secret '{secret_name}' parsed as JSON but key '{key}' not found. "
                               f"Available keys: {list(secret_dict.keys())}")
            return value
        except (json.JSONDecodeError, TypeError):
            # Plain text secret — return as-is
            if secret_string:
                logger.info(f"Secret '{secret_name}' loaded as plain text (len={len(secret_string)})")
            else:
                logger.warning(f"Secret '{secret_name}' returned empty string")
            return secret_string if secret_string else None
    except Exception as e:
        logger.error(f"Failed to fetch secret '{secret_name}' key='{key}': {type(e).__name__}: {e}")
        return None


class Config:
    """Base configuration class"""

    APP_ENV = os.getenv('APP_ENV', 'development')

    # AWS Settings
    AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
    AWS_PROFILE = os.getenv('AWS_PROFILE')
    USE_AWS_PROFILE = os.getenv('USE_AWS_PROFILE', 'false').lower() == 'true'

    # AWS Bedrock Settings
    BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID')

    # DynamoDB Table Names
    RISK_ASSESSMENTS_TABLE = os.environ.get('RISK_ASSESSMENTS_TABLE', 'haf-ara-dev-risk-assessments')
    PATTERNS_TABLE = os.environ.get('PATTERNS_TABLE', 'haf-ara-dev-wave-patterns')
    ATX_ASSESSMENTS_TABLE = os.environ.get('ATX_ASSESSMENTS_TABLE', 'haf-ara-dev-atx-assessments')
    ATX_PROCESSING_TASKS_TABLE = os.environ.get('ATX_PROCESSING_TASKS_TABLE', 'haf-ara-dev-atx-processing-tasks')
    ATX_TRANSFORMATION_NAME = os.environ.get('ATX_TRANSFORMATION_NAME', 'AWS/comprehensive-codebase-analysis')
    TARGET_COMPONENTS_TABLE = os.environ.get('TARGET_COMPONENTS_TABLE', 'haf-uno-data-plane-dev-target-components')
    PROCESSING_TASKS_TABLE = os.environ.get('PROCESSING_TASKS_TABLE', 'haf-uno-data-plane-dev-processing-tasks')
    APP_COMPONENTS_TABLE = os.environ.get('APP_COMPONENTS_TABLE', 'haf-uno-data-plane-dev-app-components')
    DEFAULT_OS_VERSION_TABLE = os.environ.get('DEFAULT_OS_VERSION_TABLE', 'haf-uno-data-plane-dev-default-os-versions')
    APPLICATIONS_TABLE = os.environ.get('APPLICATIONS_TABLE', 'haf-uno-data-plane-dev-applications')

    # S3 ARA Bucket (ARA's own bucket for ATX results, risk reports, patterns)
    S3_ARA_BUCKET = os.environ.get('S3_ARA_BUCKET') or os.environ.get('S3_ASSETS_BUCKET')

    # S3 UNO Data Plane Bucket (UNO's bucket where notes/ATX files are uploaded)
    S3_UNO_DP_BUCKET = os.environ.get('S3_UNO_DP_BUCKET') or os.environ.get('S3_NOTES_BUCKET')

    # GitHub Settings — injected by ECS task definition from Secrets Manager
    GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')

    # Logging
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    # Performance Settings
    BOTO3_MAX_POOL_CONNECTIONS = int(os.environ.get('BOTO3_MAX_POOL_CONNECTIONS', '20'))
    MAX_PARALLEL_WORKERS = int(os.environ.get('MAX_PARALLEL_WORKERS', '4'))
    MAX_PARALLEL_ASSESSMENTS = int(os.environ.get('MAX_PARALLEL_ASSESSMENTS', '10'))

    # ECS Fargate (ATX worker tasks)
    ECS_CLUSTER = os.environ.get('ECS_CLUSTER', '')
    ECS_ATX_TASK_DEFINITION = os.environ.get('ECS_ATX_TASK_DEFINITION', '')
    ECS_SUBNETS = os.environ.get('ECS_SUBNETS', '')
    ECS_SECURITY_GROUPS = os.environ.get('ECS_SECURITY_GROUPS', '')
    ATX_SHELL_TIMEOUT = int(os.environ.get('ATX_SHELL_TIMEOUT', '36000'))

    # ATX run mode: 'ecs' (Fargate tasks) or 'local' (thread pool)
    ATX_RUN_MODE = os.environ.get('ATX_RUN_MODE', 'local')

    # Max auto-resume attempts for combined ATX runs on timeout (0 = disabled)
    ATX_COMBINED_MAX_RESUME_ATTEMPTS = int(os.environ.get('ATX_COMBINED_MAX_RESUME_ATTEMPTS', '5'))

    # CORS
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',')
    CORS_SUPPORTS_CREDENTIALS = True
    CORS_MAX_AGE = 3600

    @staticmethod
    def get_boto3_session():
        """Get boto3 session based on environment configuration."""
        if Config.USE_AWS_PROFILE and Config.AWS_PROFILE:
            return boto3.Session(
                profile_name=Config.AWS_PROFILE,
                region_name=Config.AWS_REGION
            )
        return boto3.Session(region_name=Config.AWS_REGION)

    @staticmethod
    def get_boto3_client(service_name: str, **kwargs):
        """Get boto3 client with proper credentials and configuration."""
        session = Config.get_boto3_session()
        config_kwargs = {
            'region_name': Config.AWS_REGION,
            'retries': {'max_attempts': 3, 'mode': 'adaptive'},
            'max_pool_connections': Config.BOTO3_MAX_POOL_CONNECTIONS,
        }
        # Bedrock inference can take a while on large prompts
        if service_name == 'bedrock-runtime':
            config_kwargs['read_timeout'] = 300
            config_kwargs['connect_timeout'] = 10
        boto_config = BotoConfig(**config_kwargs)
        if 'config' in kwargs:
            user_config = kwargs.pop('config')
            boto_config = boto_config.merge(user_config)
        return session.client(service_name, config=boto_config, **kwargs)

    @staticmethod
    def get_boto3_resource(service_name: str, **kwargs):
        """Get boto3 resource with proper credentials."""
        session = Config.get_boto3_session()
        return session.resource(service_name, region_name=Config.AWS_REGION, **kwargs)


def get_config(config_name: Optional[str] = None) -> Config:
    """Return the Config class. Config name parameter kept for backward compatibility."""
    return Config
