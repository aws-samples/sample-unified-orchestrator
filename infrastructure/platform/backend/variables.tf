# ============================================================================
# Backend Component - Variables
# ============================================================================

# ============================================================================
# Naming & Environment
# ============================================================================

variable "naming_prefix" {
  description = "Common resource naming prefix (e.g., 'haf-uno-useast1-dev')"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., dev, prod)"
  type        = string
}

variable "aws_region" {
  description = "AWS region (e.g., us-east-1)"
  type        = string
}

# ============================================================================
# VPC & Networking
# ============================================================================

variable "vpc_id" {
  description = "VPC ID where ECS resources are deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for ECS tasks and ASG"
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB (for ECS task SG ingress)"
  type        = string
}

variable "target_group_arn" {
  description = "Target group ARN for the ECS service load balancer"
  type        = string
}

variable "alb_listener_arn" {
  description = "ALB listener ARN — used only to establish dependency ordering (ECS service waits for listener)"
  type        = string
  default     = ""
}

# ============================================================================
# ECS Cluster & Capacity Provider
# ============================================================================

variable "instance_type" {
  description = "EC2 instance type for ECS capacity provider"
  type        = string
  default     = "t3.medium"
}

variable "asg_min_size" {
  description = "Minimum size of the Auto Scaling Group"
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "Maximum size of the Auto Scaling Group"
  type        = number
  default     = 3
}

variable "asg_desired_capacity" {
  description = "Desired capacity of the Auto Scaling Group"
  type        = number
  default     = 2
}

variable "volume_size" {
  description = "EBS volume size in GiB for ECS EC2 instances"
  type        = number
  default     = 30
}

# ============================================================================
# Container & Task Definition
# ============================================================================

variable "container_image" {
  description = "Full container image reference. Leave empty to use the ECR repo created by this module."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Container image tag for the ECR repository. Set by CI/CD pipeline using commit SHA (e.g., a1b2c3d-20240115-143022)."
  type        = string
  default     = "initial"
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 8000
}

variable "task_cpu" {
  description = "CPU units for the ECS task"
  type        = string
  default     = "512"
}

variable "task_memory" {
  description = "Memory for the ECS task in MB"
  type        = string
  default     = "1024"
}

variable "desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "container_environment" {
  description = "Additional environment variables for the container"
  type        = list(map(string))
  default     = []
}

variable "registry_credentials_secret_arn" {
  description = "Optional AWS Secrets Manager ARN containing private registry credentials for ECS repositoryCredentials (e.g., JFrog)"
  type        = string
  default     = ""
}

# ============================================================================
# Encryption & Logging
# ============================================================================

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
  default     = ""
}

variable "ecs_log_retention_days" {
  description = "CloudWatch log retention in days for ECS backend log group"
  type        = number
  default     = 7
}


# ============================================================================
# Application Dependencies
# ============================================================================

variable "assets_bucket_name" {
  description = "S3 bucket name for assets"
  type        = string
  default     = ""
}

variable "dynamodb_tables" {
  description = "Map of DynamoDB table names (key => full table name)"
  type        = map(string)
  default     = {}
}

variable "enable_dynamodb_pitr" {
  description = "Enable Point-in-Time Recovery for DynamoDB tables"
  type        = bool
  default     = false
}

# ============================================================================
# Cognito Integration
# ============================================================================

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID for JWT validation and user management"
  type        = string
  default     = ""
}

variable "cognito_region" {
  description = "AWS region of the Cognito User Pool"
  type        = string
  default     = ""
}

variable "cors_origins" {
  description = "Comma-separated CORS origins for backend API"
  type        = string
  default     = ""
}

# ============================================================================
# Proxy Configuration
# ============================================================================

variable "http_proxy" {
  description = "HTTP proxy URL for ECS EC2 instances"
  type        = string
  default     = ""
}

variable "https_proxy" {
  description = "HTTPS proxy URL for ECS EC2 instances"
  type        = string
  default     = ""
}

variable "no_proxy" {
  description = "Comma-separated list of no-proxy hosts for ECS EC2 instances"
  type        = string
  default     = ""
}

# ============================================================================
# IAM & Permission Boundary
# ============================================================================

variable "permission_boundary_name" {
  description = "IAM permissions boundary policy name to attach to all IAM roles (null to skip)"
  type        = string
  default     = null
}

# ============================================================================
# Tagging
# ============================================================================

variable "tags" {
  description = "Base tags applied to all resources"
  type        = map(string)
  default     = {}
}

variable "additional_tags" {
  description = "Additional component-specific tags (e.g., Component = Backend)"
  type        = map(string)
  default     = {}
}

# ---------- AVP (Amazon Verified Permissions) ----------

variable "enable_avp" {
  description = "Whether AVP is enabled for authorization"
  type        = bool
  default     = false
}

variable "avp_policy_store_id" {
  description = "AVP policy store ID (empty when AVP disabled)"
  type        = string
  default     = ""
}

variable "avp_policy_store_arn" {
  description = "AVP policy store ARN (empty when AVP disabled)"
  type        = string
  default     = ""
}
