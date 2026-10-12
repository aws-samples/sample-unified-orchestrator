# ============================================================================
# Proxy Component - Variables
# ============================================================================

# ============================================================================
# Naming & Environment
# ============================================================================

variable "naming_prefix" {
  description = "Common resource naming prefix (e.g., 'haf-uno-useast1-dev')"
  type        = string
}

# ============================================================================
# VPC & Networking
# ============================================================================

variable "vpc_id" {
  description = "VPC ID for the proxy security group"
  type        = string
}

variable "private_subnet_id" {
  description = "Private subnet ID for the EC2 proxy instance"
  type        = string
}

variable "allowed_ingress_cidrs" {
  description = "CIDR blocks allowed for HTTP/HTTPS ingress to the proxy"
  type        = list(string)
}

# ============================================================================
# EC2 Instance
# ============================================================================

variable "instance_type" {
  description = "EC2 instance type for the Nginx proxy"
  type        = string
  default     = "t3.micro"
}

variable "root_volume_size" {
  description = "Root EBS volume size in GiB for the proxy instance"
  type        = number
  default     = 30
}

# ============================================================================
# Domain & Routing Configuration
# ============================================================================

variable "control_plane_domain" {
  description = "Control plane server_name for the Nginx server block (e.g., 'uno.dev.att.com')"
  type        = string
}

variable "cognito_domain" {
  description = "Cognito hosted UI FQDN for OAuth2 proxy routing via socat tunnel"
  type        = string
}

# ============================================================================
# Proxy Configuration (Internet Access via SSM)
# ============================================================================

variable "ssm_parameter_prefix" {
  description = "SSM parameter prefix for reading base infrastructure values (e.g., '/haf/useast1/nprd')"
  type        = string
}

variable "http_proxy_url" {
  description = "HTTP proxy URL (parsed from SSM in root locals)"
  type        = string
  default     = ""
}

variable "https_proxy_url" {
  description = "HTTPS proxy URL (parsed from SSM in root locals)"
  type        = string
  default     = ""
}

variable "no_proxy_list" {
  description = "NO_PROXY list (merged from SSM + defaults in root locals)"
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
  description = "Additional component-specific tags (e.g., Component = Proxy)"
  type        = map(string)
  default     = {}
}

# ============================================================================
# Frontend S3 Bucket (for Nginx S3 proxy)
# ============================================================================

variable "frontend_bucket_name" {
  description = "S3 bucket name for frontend assets (Nginx proxies to this bucket)"
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region for S3 endpoint URL"
  type        = string
  default     = "us-east-1"
}
