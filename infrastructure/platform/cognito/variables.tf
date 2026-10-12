# -----------------------------------------------------------------------------
# Cognito Authentication Component — Input Variables
# -----------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
}

variable "project_name" {
  description = "Project name used for resource naming (typically naming_prefix from root)"
  type        = string
}

variable "domain_suffix" {
  description = "Suffix for Cognito domain (must be unique across AWS)"
  type        = string
  default     = "auth"
}

# -----------------------------------------------------------------------------
# Entra ID Federated User Pool (Optional)
# -----------------------------------------------------------------------------

variable "create_entra_user_pool" {
  description = "Create a second Cognito user pool federated to Microsoft Entra ID"
  type        = bool
  default     = false
}

variable "entra_domain_suffix" {
  description = "Suffix for the Entra-federated Cognito domain (must be unique across AWS)"
  type        = string
  default     = "entra-auth"
}

variable "entra_callback_urls" {
  description = "Optional callback URLs for the Entra-federated ALB client; defaults to callback_urls when empty"
  type        = list(string)
  default     = []
}

variable "entra_logout_urls" {
  description = "Optional logout URLs for the Entra-federated ALB client; defaults to logout_urls when empty"
  type        = list(string)
  default     = []
}

variable "entra_identity_provider_name" {
  description = "Provider name shown by Cognito for the Entra ID identity provider"
  type        = string
  default     = "EntraID"
}

variable "entra_metadata_url" {
  description = "SAML metadata URL for the Entra ID enterprise application"
  type        = string
  default     = ""
}

variable "entra_metadata_file" {
  description = "SAML metadata XML document for the Entra ID enterprise application"
  type        = string
  default     = ""
}

variable "allow_placeholder_entra_metadata_url" {
  description = "Allow the known placeholder Entra metadata URL for the first Terraform apply only"
  type        = bool
  default     = false
}

variable "entra_idp_signout" {
  description = "Whether Cognito should use SAML single logout with Entra ID"
  type        = bool
  default     = true
}

variable "entra_attribute_mapping" {
  description = "Mapping from Cognito attributes to Entra ID SAML claims"
  type        = map(string)
  default = {
    # Standard email claim
    email = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
    # Groups claim — Entra emits this as a multi-value attribute
    # The key is the Cognito custom attribute name (without custom: prefix)
    "custom:groups" = "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
  }
}

# -----------------------------------------------------------------------------
# ALB Client — Callback and Logout URLs
# -----------------------------------------------------------------------------

variable "callback_urls" {
  description = "List of callback URLs for ALB authentication"
  type        = list(string)
}

variable "logout_urls" {
  description = "List of logout URLs"
  type        = list(string)
}

variable "generate_client_secret" {
  description = "Generate client secret for ALB client (true for ALB authenticate-cognito, false for SPA/Nginx proxy auth)"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Frontend Client (Optional)
# -----------------------------------------------------------------------------

variable "create_frontend_client" {
  description = "Create a separate client for frontend SPA direct access"
  type        = bool
  default     = false
}

variable "frontend_callback_urls" {
  description = "List of callback URLs for frontend client"
  type        = list(string)
  default     = []
}

variable "frontend_logout_urls" {
  description = "List of logout URLs for frontend client"
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# Admin User (Optional)
# -----------------------------------------------------------------------------

variable "create_admin_user" {
  description = "Create an initial admin user"
  type        = bool
  default     = false
}

variable "admin_email" {
  description = "Admin user email address"
  type        = string
  default     = ""
}

variable "admin_temporary_password" {
  description = "Temporary password for admin user"
  type        = string
  default     = ""
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Pre-Authentication Lambda (Entra ID)
# -----------------------------------------------------------------------------

variable "enable_pre_auth_lambda" {
  description = "Enable the pre-authentication Lambda trigger for Entra ID federation"
  type        = bool
  default     = false
}

variable "pre_auth_allowed_email_domains" {
  description = "List of allowed email domains for Entra ID authentication (empty = allow all)"
  type        = list(string)
  default     = []
}

variable "pre_auth_log_level" {
  description = "Log level for the pre-authentication Lambda (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

variable "pre_auth_log_retention_days" {
  description = "CloudWatch log retention in days for the pre-auth Lambda"
  type        = number
  default     = 14
}

variable "permission_boundary_arn" {
  description = "IAM permissions boundary ARN to attach to Lambda IAM roles"
  type        = string
  default     = null
}

variable "kms_key_arn" {
  description = "KMS key ARN for encrypting CloudWatch log group and Lambda environment variables"
  type        = string
  default     = null
}

variable "pre_auth_lambda_reserved_concurrency" {
  description = "Reserved concurrent executions for the pre-auth Lambda function"
  type        = number
  default     = 10
}

variable "pre_auth_lambda_subnet_ids" {
  description = "Subnet IDs for the pre-auth Lambda VPC configuration"
  type        = list(string)
  default     = []
}

variable "pre_auth_lambda_security_group_ids" {
  description = "Security group IDs for the pre-auth Lambda VPC configuration"
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# Tagging
# -----------------------------------------------------------------------------

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
