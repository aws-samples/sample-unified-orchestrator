# ============================================================================
# UNO Unified Orchestrator - Variables
# ============================================================================

# ============================================================================
# Common Variables
# ============================================================================

variable "prefix" {
  description = "Prefix for all resources (e.g., 'haf-uno')"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, nprd, test, qa, perf, uat, trn, poc, stge, dr, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "nprd", "test", "qa", "perf", "uat", "trn", "poc", "stge", "dr", "prod"], var.environment)
    error_message = "Environment must be a valid AT&T environment abbreviation."
  }
}

variable "region" {
  description = "AWS region code (e.g., 'useast1')"
  type        = string
}

# ============================================================================
# Base Infrastructure References
# ============================================================================

variable "ssm_parameter_prefix" {
  description = "SSM parameter prefix for reading base infrastructure values (e.g., '/haf-uno/useast1/dev')"
  type        = string
}

# uno_ssm_prefix is auto-derived in locals.tf: /${prefix}/${region}/${environment}

variable "aws_region" {
  description = "AWS region (e.g., 'us-east-1')"
  type        = string
  default     = "us-east-1"
}

# ============================================================================
# Common/Networking Variables
# ============================================================================

variable "backend_port" {
  description = "Port for backend service"
  type        = number
  default     = 8000
}

variable "backend_health_check_path" {
  description = "Health check path for backend"
  type        = string
  default     = "/health"
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
  default     = ""
}

variable "enable_deletion_protection" {
  description = "Enable deletion protection for ALB"
  type        = bool
  default     = false
}

variable "nlb_create_http_listener" {
  description = "Whether to create an HTTP (port 80) listener on the NLB"
  type        = bool
  default     = false
}

variable "enable_cognito_auth" {
  description = "Enable Cognito authentication on ALB (requires HTTPS)"
  type        = bool
  default     = false
}

variable "cognito_domain_suffix" {
  description = "Suffix for Cognito domain (must be unique across AWS)"
  type        = string
  default     = "auth"
}

variable "create_entra_cognito_user_pool" {
  description = "Create a second Cognito user pool federated to Microsoft Entra ID"
  type        = bool
  default     = false
}

variable "use_entra_cognito_for_alb_auth" {
  description = "Use the Entra-federated Cognito user pool for ALB authentication"
  type        = bool
  default     = false

  validation {
    condition     = !var.use_entra_cognito_for_alb_auth || var.create_entra_cognito_user_pool
    error_message = "use_entra_cognito_for_alb_auth requires create_entra_cognito_user_pool to be true."
  }
}

variable "cognito_entra_domain_suffix" {
  description = "Suffix for the Entra-federated Cognito domain (must be unique across AWS)"
  type        = string
  default     = "entra-auth"
}

variable "cognito_entra_callback_urls" {
  description = "Optional callback URLs for the Entra-federated Cognito client"
  type        = list(string)
  default     = []
}

variable "cognito_entra_logout_urls" {
  description = "Optional logout URLs for the Entra-federated Cognito client"
  type        = list(string)
  default     = []
}

variable "cognito_entra_identity_provider_name" {
  description = "Provider name shown by Cognito for the Entra ID identity provider"
  type        = string
  default     = "EntraID"
}

variable "cognito_entra_metadata_url" {
  description = "SAML metadata URL for the Entra ID enterprise application"
  type        = string
  default     = ""
}

variable "cognito_entra_metadata_file" {
  description = "SAML metadata XML document for the Entra ID enterprise application"
  type        = string
  default     = ""
}

variable "cognito_entra_allow_placeholder_metadata_url" {
  description = "Allow the known placeholder Entra metadata URL for the first Terraform apply only"
  type        = bool
  default     = false
}

variable "cognito_entra_idp_signout" {
  description = "Whether Cognito should use SAML single logout with Entra ID"
  type        = bool
  default     = true
}

variable "cognito_entra_attribute_mapping" {
  description = "Mapping from Cognito attributes to Entra ID SAML claims"
  type        = map(string)
  default = {
    # Standard email claim
    email = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    # Groups claim — Entra emits this as a multi-value attribute
    "custom:groups" = "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
  }
}

# ============================================================================
# Cognito Variables
# ============================================================================

variable "create_cognito_frontend_client" {
  description = "Create a separate Cognito client for frontend direct access"
  type        = bool
  default     = false
}

variable "cognito_frontend_callback_urls" {
  description = "List of callback URLs for frontend Cognito client"
  type        = list(string)
  default     = []
}

variable "cognito_frontend_logout_urls" {
  description = "List of logout URLs for frontend Cognito client"
  type        = list(string)
  default     = []
}

variable "create_cognito_admin_user" {
  description = "Create an initial admin user in Cognito"
  type        = bool
  default     = false
}

variable "cognito_admin_email" {
  description = "Admin user email address for Cognito"
  type        = string
  default     = ""
}

variable "cognito_admin_temporary_password" {
  description = "Temporary password for Cognito admin user"
  type        = string
  default     = ""
  sensitive   = true
}

# ============================================================================
# Backend Variables
# ============================================================================

variable "container_image" {
  description = "Full container image reference (e.g., JFrog image URI with tag)"
  type        = string
  default     = ""
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

variable "ecs_log_retention_days" {
  description = "CloudWatch log retention in days for ECS backend log group"
  type        = number
  default     = 7
}

variable "registry_credentials_secret_arn" {
  description = "Optional AWS Secrets Manager ARN containing private registry credentials for ECS repositoryCredentials"
  type        = string
  default     = ""
}

variable "container_environment" {
  description = "Environment variables for the container"
  type        = list(map(string))
  default     = []
}

variable "cors_origins" {
  description = "Comma-separated CORS origins for backend API"
  type        = string
  default     = ""
}

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

variable "dynamodb_table_suffixes" {
  description = "Map of DynamoDB table suffix names (prefixed with naming_prefix automatically)"
  type        = map(string)
  default = {
    risk_assessments       = "risk-assessments"
    applications           = "applications"
    wave_patterns          = "wave-patterns"
    target_components      = "target-components"
    processing_tasks       = "processing-tasks"
    app_components         = "app-components"
    app_noise_components   = "app-noise-components"
    default_os_versions    = "default-os-versions"
    pod_user_applications  = "pod-user-applications"
  }
}

variable "enable_dynamodb_pitr" {
  description = "Enable Point-in-Time Recovery for DynamoDB tables"
  type        = bool
  default     = false
}

variable "assets_bucket_suffix" {
  description = "Suffix for the assets S3 bucket (prefixed with naming_prefix and suffixed with account_id)"
  type        = string
  default     = "assets"
}

variable "bucket_name_suffix" {
  description = "Suffix appended to all S3 bucket names for uniqueness (e.g., account ID or random string)"
  type        = string
  default     = ""
}

# ============================================================================
# Frontend Variables
# ============================================================================

variable "frontend_bucket_name" {
  description = "Name of the frontend S3 bucket (overrides auto-derived name)"
  type        = string
  default     = ""
}

variable "create_frontend_bucket" {
  description = "Create frontend S3 bucket (set to false if bucket already exists)"
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Allow S3 buckets to be destroyed even if they contain objects"
  type        = bool
  default     = false
}

variable "s3_vpc_endpoint_id" {
  description = "Existing S3 VPC endpoint ID for bucket policy"
  type        = string
  default     = ""
}

variable "create_logging_bucket" {
  description = "Create a separate bucket for ALB access logs"
  type        = bool
  default     = true
}

# ============================================================================
# Tagging Variables (Consolidated)
# ============================================================================

variable "application_name" {
  description = "Application name for resource tagging (AT&T standard)"
  type        = string
  default     = "Unified Orchestrator"
}

variable "project" {
  description = "Project name for resource tagging (AT&T standard)"
  type        = string
  default     = "UNO"
}

variable "managed_by" {
  description = "Management tool for resource tagging"
  type        = string
  default     = "Terraform"
}

variable "repository" {
  description = "Repository name for resource tagging"
  type        = string
  default     = "unified-orchestrator"
}

variable "purpose" {
  description = "Purpose of the resources for AT&T mandatory tagging (lowercase, no spaces)"
  type        = string
  default     = "unifiedorchestrator"
}

variable "correlation_id" {
  description = "Correlation ID for tracking related resources (AT&T standard)"
  type        = string
  default     = ""
}

variable "created_by" {
  description = "Creator identifier for resource tracking (AT&T standard)"
  type        = string
  default     = ""
}

variable "contact_dl" {
  description = "Contact distribution list for resource ownership (AT&T standard)"
  type        = string
  default     = ""
}

variable "additional_tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}

# ============================================================================
# Permission Boundary Configuration
# ============================================================================

variable "permission_boundary_name" {
  description = "IAM permissions boundary policy name to attach to IAM roles (e.g., 'hafv4-nprd-role-permission-boundary')"
  type        = string
  default     = null
}

# ============================================================================
# Nginx Proxy Variables
# ============================================================================

variable "enable_nginx_proxy" {
  description = "Enable the optional Nginx reverse proxy EC2 instance"
  type        = bool
  default     = false
}

variable "enable_nginx_alb_routing" {
  description = "Enable Nginx-based ALB listener rules (path-based routing to Nginx proxy)"
  type        = bool
  default     = false
}

variable "control_plane_domain" {
  description = "Control plane domain for the Nginx proxy server block (e.g., 'uno.dev.att.com')"
  type        = string
  default     = ""
}

variable "proxy_allowed_ingress_cidrs" {
  description = "CIDR blocks allowed for HTTP/HTTPS ingress to the Nginx proxy"
  type        = list(string)
  default     = []
}

# ============================================================================
# Entra ID (Azure AD) Federation Variables
# ============================================================================

variable "enable_entra_id_pre_auth_lambda" {
  description = "Enable the pre-authentication Lambda trigger for Entra ID (Azure AD) federation"
  type        = bool
  default     = false
}

variable "entra_id_allowed_email_domains" {
  description = "List of allowed email domains for Entra ID authentication (empty = allow all domains)"
  type        = list(string)
  default     = []
}

variable "entra_id_pre_auth_log_level" {
  description = "Log level for the Entra ID pre-authentication Lambda (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

variable "entra_id_pre_auth_log_retention_days" {
  description = "CloudWatch log retention in days for the Entra ID pre-auth Lambda"
  type        = number
  default     = 14
}

# ============================================================================
# NLB & PrivateLink Variables
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

# ---------- AVP (Amazon Verified Permissions) ----------

variable "enable_avp" {
  description = "Whether to create AVP policy store and Cedar policies. Set to true once AVP is ready for the environment."
  type        = bool
  default     = false
}
