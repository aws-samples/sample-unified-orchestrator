# ============================================================================
# UNO Common/Networking Component - Variables
# ============================================================================

# ============================================================================
# VPC & Network
# ============================================================================

variable "vpc_id" {
  description = "VPC ID where the ALB and security group will be created"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block for security group ingress rules"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for the internal ALB"
  type        = list(string)
}

# ============================================================================
# Encryption & Certificates
# ============================================================================

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener (empty string disables HTTPS listener)"
  type        = string
  default     = ""
}

# ============================================================================
# ALB Configuration
# ============================================================================

variable "naming_prefix" {
  description = "Resource naming prefix following AT&T convention (e.g., haf-uno-useast1-dev)"
  type        = string
}

variable "backend_port" {
  description = "Port for backend service target group"
  type        = number
  default     = 8080
}

variable "backend_health_check_path" {
  description = "Health check path for backend target group"
  type        = string
  default     = "/health"
}

variable "logs_bucket_id" {
  description = "S3 bucket ID for ALB access logs"
  type        = string
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for the ALB"
  type        = bool
  default     = false
}

# ============================================================================
# Cognito Authentication
# ============================================================================

variable "enable_cognito_auth" {
  description = "Enable Cognito authentication action on HTTPS listener"
  type        = bool
  default     = false
}

variable "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN for ALB authentication action"
  type        = string
  default     = ""
}

variable "cognito_user_pool_client_id" {
  description = "Cognito User Pool Client ID for ALB authentication action"
  type        = string
  default     = ""
}

variable "cognito_user_pool_domain" {
  description = "Cognito User Pool domain for ALB authentication action"
  type        = string
  default     = ""
}

# ============================================================================
# Tagging
# ============================================================================

variable "tags" {
  description = "Base tags applied to all resources (from provider default_tags)"
  type        = map(string)
  default     = {}
}

variable "additional_tags" {
  description = "Additional component-specific tags to merge with base tags"
  type        = map(string)
  default     = {}
}

# ============================================================================
# NLB + PrivateLink Configuration
# ============================================================================

variable "create_nlb_privatelink" {
  description = "Create a Network Load Balancer and VPC Endpoint Service (PrivateLink) in front of the ALB"
  type        = bool
  default     = false
}

variable "nlb_internal" {
  description = "Whether the NLB is internal (true) or internet-facing (false)"
  type        = bool
  default     = true
}

variable "nlb_create_http_listener" {
  description = "Create an HTTP (port 80) TCP listener on the NLB"
  type        = bool
  default     = false
}

variable "privatelink_acceptance_required" {
  description = "Require manual acceptance of VPC endpoint connections"
  type        = bool
  default     = true
}

variable "privatelink_allowed_principals" {
  description = "List of AWS principal ARNs allowed to create VPC endpoint connections"
  type        = list(string)
  default     = []
}

# ============================================================================
# Nginx ALB Routing
# ============================================================================

variable "enable_nginx_alb_routing" {
  description = "Enable Nginx-based ALB listener rules (path-based routing to Nginx proxy)"
  type        = bool
  default     = false
}

variable "nginx_instance_id" {
  description = "Nginx EC2 instance ID for ALB target group registration"
  type        = string
  default     = ""
}
