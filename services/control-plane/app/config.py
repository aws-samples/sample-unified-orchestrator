"""
Application Configuration

Lightweight configuration for the UNO backend.
Uses Pydantic BaseSettings for environment-based configuration with validation.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App settings
    ENVIRONMENT: str = "dev"
    DEBUG: bool = False
    APP_ENV: str = "production"  # dev-mode detection (replaces FLASK_ENV)

    # AWS
    AWS_REGION: str = "us-east-1"

    # Cognito
    COGNITO_USER_POOL_ID: str = ""
    COGNITO_REGION: str = "us-east-1"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    # Logging
    LOG_LEVEL: str = "INFO"

    # PAM API Configuration
    PAM_API_BASE_URL: str = ""
    PAM_API_TIMEOUT: int = 30
    PAM_API_MAX_RETRIES: int = 3
    PAM_API_RETRY_BACKOFF: float = 1.0

    # Notes / S3 Configuration
    S3_UNO_DP_BUCKET: str = ""

    # DynamoDB Table Names
    APPLICATIONS_TABLE: str = "haf-uno-data-plane-dev-applications"

    # DynamoDB Table Names (Notes)
    DYNAMODB_PROCESSING_TASKS_TABLE: str = "haf-uno-data-plane-dev-processing-tasks"
    DYNAMODB_TARGET_COMPONENTS_TABLE: str = "haf-uno-data-plane-dev-target-components"
    DYNAMODB_DEFAULT_OS_VERSIONS_TABLE: str = "haf-uno-data-plane-dev-default-os-versions"
    DYNAMODB_APP_COMPONENTS_TABLE: str = "haf-uno-data-plane-dev-app-components"
    DYNAMODB_APP_NOISE_COMPONENTS_TABLE: str = "haf-uno-data-plane-dev-app-noise-components"

    # AI / Bedrock
    BEDROCK_MODEL_ID: str = "us.amazon.nova-2-pro-preview-20251202-v1:0"
    AI_NORMALIZATION_WORKERS: int = 5

    # Server
    PORT: int = 6001

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS_ORIGINS comma-separated string into a list of trimmed origins."""
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    return Settings()
