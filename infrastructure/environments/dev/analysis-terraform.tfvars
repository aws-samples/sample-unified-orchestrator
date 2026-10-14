# Environment Configuration
team_name    = "haf"
environment  = "dev"
project_name = "ara"
aws_region   = "us-east-1"

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
cors_origins = "http://localhost:3000"

# S3
s3_ara_bucket_name    = "haf-ara-dev-assets-123456789012"
s3_uno_dp_bucket_name = "haf-uno-data-plane-dev-assets-123456789012"

# Secrets
github_token_secret_arn = ""  # e.g. "arn:aws:secretsmanager:us-east-1:123456789012:secret:<name>" — supply at deploy time

# DynamoDB Tables (ARA-owned only — UNO tables come from SSM)
dynamodb_tables = {
  risk_assessments     = "haf-ara-dev-risk-assessments"
  wave_patterns        = "haf-ara-dev-wave-patterns"
  atx_assessments      = "haf-ara-dev-atx-assessments"
  atx_processing_tasks = "haf-ara-dev-atx-processing-tasks"
}

# Tags
tags = {
  Project     = "application-replatform-analyzer"
  Environment = "dev"
  ManagedBy   = "terraform"
}

# ALB Integration
enable_alb_integration     = true
alb_listener_rule_priority = 100
alb_path_patterns          = ["/api/v1/ara/*"]
health_check_path          = "/api/v1/ara/health"
