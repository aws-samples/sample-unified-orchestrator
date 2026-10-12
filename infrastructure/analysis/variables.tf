variable "prefix" {
  description = "Resource naming prefix (e.g. haf-ara)"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., nprd, trn, prod)"
  type        = string
}

variable "region_code" {
  description = "Short region code for naming (e.g. useast1)"
  type        = string
  default     = "useast1"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 8000
}

variable "task_cpu" {
  description = "CPU units for the task"
  type        = string
  default     = "512"
}

variable "task_memory" {
  description = "Memory for the task in MB"
  type        = string
  default     = "1024"
}

variable "desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 1
}

variable "instance_type" {
  description = "EC2 instance type for ECS cluster"
  type        = string
  default     = "t3.medium"
}

variable "asg_min_size" {
  description = "ASG minimum size"
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "ASG maximum size"
  type        = number
  default     = 2
}

variable "asg_desired_capacity" {
  description = "ASG desired capacity"
  type        = number
  default     = 1
}

variable "bedrock_model_id" {
  description = "Bedrock model ID"
  type        = string
  default     = "anthropic.claude-sonnet-4-20250514"
}

variable "cors_origins" {
  description = "Allowed CORS origins (comma-separated). Set to the specific frontend origin per environment — do not use '*' on an authenticated API."
  type        = string
  default     = ""
}

variable "container_environment" {
  description = "Additional environment variables for the container"
  type        = list(map(string))
  default     = []
}

variable "s3_ara_bucket_name" {
  description = "S3 bucket for ARA (ATX results, risk reports, patterns). Auto-derived if empty."
  type        = string
  default     = ""
}

variable "bucket_name_suffix" {
  description = "Suffix appended to all S3 bucket names for uniqueness (e.g., account ID or sequential number)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# ---------- ALB Integration (optional) ----------

variable "enable_alb_integration" {
  description = "Whether to create target group and ALB listener rule"
  type        = bool
  default     = false
}

variable "alb_listener_arn" {
  description = "ARN of the existing ALB HTTPS/HTTP listener to attach the rule to"
  type        = string
  default     = ""
}

variable "alb_listener_rule_priority" {
  description = "Priority for the ALB listener rule"
  type        = number
  default     = 100
}

variable "health_check_path" {
  description = "Health check path for the target group"
  type        = string
  default     = "/api/v1/ara/health"
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB (to allow inbound from ALB to ECS tasks)"
  type        = string
  default     = ""
}

variable "github_token_secret_arn" {
  description = "ARN of the Secrets Manager secret containing GITHUB_TOKEN"
  type        = string
}

variable "permission_boundary_name" {
  description = "IAM permissions boundary policy name to attach to all IAM roles (null to skip)"
  type        = string
  default     = null
}

variable "uno_ssm_prefix" {
  description = "SSM parameter prefix for UNO shared resources (e.g., /haf-uno/useast1/trn). If empty, auto-derived from environment."
  type        = string
  default     = ""
}

variable "base_ssm_prefix" {
  description = "SSM parameter prefix for base infrastructure resources (e.g., /haf/useast1/trn). If empty, auto-derived from environment."
  type        = string
  default     = ""
}

variable "dynamodb_tables" {
  description = "Map of ARA-owned DynamoDB table names"
  type        = map(string)
  default = {
    risk_assessments     = "haf-ara-dev-risk-assessments"
    wave_patterns        = "haf-ara-dev-wave-patterns"
    atx_assessments      = "haf-ara-dev-atx-assessments"
    atx_processing_tasks = "haf-ara-dev-atx-processing-tasks"
  }
}

variable "alb_path_patterns" {
  description = "Path patterns for the ALB listener rule"
  type        = list(string)
  default     = ["/api/v1/ara/*"]
}

# ---------- CCoE PKCE Auth Configuration ----------

variable "auth_mode" {
  description = "Authentication mode: 'cognito' for production JWT validation, 'dev' to bypass auth"
  type        = string
  default     = "cognito"
}

# ---------- AVP (Amazon Verified Permissions) ----------

variable "enable_avp" {
  description = "Whether to create AVP policy store and Cedar policies. Set to true once AVP is ready for the environment."
  type        = bool
  default     = false
}
