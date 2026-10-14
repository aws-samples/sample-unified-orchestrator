# ============================================================================
# ARA - NPRD Environment Configuration
# VPC/subnets/proxy from base infra SSM, ALB/Cognito/DynamoDB from UNO SSM.
# ============================================================================

# Environment
prefix      = "haf-ara"
environment = "prod"
region_code = "useast1"
aws_region  = "us-east-1"

# SSM prefixes (auto-derived if empty, explicit for clarity)
base_ssm_prefix = "/haf/useast1/prod"
uno_ssm_prefix  = "/haf-uno/useast1/prod"

# ECS Container
container_port = 8080
task_cpu       = "512"
task_memory    = "1024"
desired_count  = 1

# EC2 instances for ECS cluster
instance_type        = "t3.medium"
asg_min_size         = 1
asg_max_size         = 2
asg_desired_capacity = 1

# Bedrock
bedrock_model_id = "us.amazon.nova-2-pro-preview-20251202-v1:0"

# CORS — set to the specific frontend origin(s). API uses credentials, so '*' is not allowed.
cors_origins = "https://REPLACE_WITH_FRONTEND_ORIGIN"

# S3
bucket_name_suffix = "01"

# Secrets
github_token_secret_arn = "" ## Sercret arn

# ARA-owned DynamoDB Tables (UNO-owned tables read from SSM)
dynamodb_tables = {
  risk_assessments     = "haf-uno-useast1-prod-risk-assessments"
  wave_patterns        = "haf-uno-useast1-prod-wave-patterns"
  atx_assessments      = "haf-ara-prod-atx-assessments"
  atx_processing_tasks = "haf-ara-prod-atx-processing-tasks"
}

# Tags
tags = {
  Project     = "application-replatform-analyzer"
  Environment = "prod"
  ManagedBy   = "terraform"
}

# Permission Boundary
permission_boundary_name = "haf-uno-prod-role-permission-boundary"

# ALB Integration — auto-read from UNO SSM
enable_alb_integration     = true
alb_listener_rule_priority = 100
alb_path_patterns          = ["/api/v1/ara/*"]
health_check_path          = "/api/v1/ara/health"
