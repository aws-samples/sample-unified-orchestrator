# ============================================================================
# UNO Unified Orchestrator - NPRD Environment Configuration
# ============================================================================

# ============================================================================
# Common Variables
# ============================================================================

prefix               = "haf-uno"
environment          = "nprd"
region               = "useast1"
ssm_parameter_prefix = "/haf/useast1/nprd"
bucket_name_suffix   = "01" # It can be Account Number

# ============================================================================
# Backend
# ============================================================================

container_image           = ""  # Uses ECR repo created by Terraform
container_port            = 8080
backend_port              = 8080
backend_health_check_path = "/health"

# JFrog registry credentials — set the Secrets Manager ARN when container_image points to JFrog
registry_credentials_secret_arn = "" # e.g., "arn:aws:secretsmanager:us-east-1:<account-id>:secret:jfrog-registry-creds"
task_cpu                  = "512"
task_memory               = "1024"
desired_count             = 2

# Container environment — nprd mode with Cognito auth
container_environment = [
  { name = "APP_ENV", value = "nprd" }
]

# ============================================================================
# Frontend
# ============================================================================

create_frontend_bucket = true
force_destroy          = true
create_logging_bucket  = true

# ============================================================================
# ALB
# ============================================================================

certificate_arn            = ""  # e.g. "arn:aws:acm:us-east-1:123456789012:certificate/<id>" — supply the ACM cert ARN at deploy time
enable_deletion_protection = false
enable_cognito_auth        = false   # Disabled — using Nginx-based routing via PrivateLink
cognito_domain_suffix      = "auth-01"

# NLB (for static IPs)
create_nlb_privatelink = true

# ============================================================================
# IAM Permission Boundary
# ============================================================================

permission_boundary_name = "haf-uno-nprd1-role-permission-boundary"

# ============================================================================
# Tagging
# ============================================================================

application_name = "Unified Orchestrator"
project          = "UNO"
managed_by       = "Terraform"
repository       = "unified-orchestrator"
purpose          = "unifiedorchestrator"
correlation_id   = ""
created_by       = ""
contact_dl       = ""

# ============================================================================
# Nginx Proxy
# ============================================================================

enable_nginx_proxy          = true
control_plane_domain        = "uno-nprd.att.nmunibac.people.aws.dev"
proxy_allowed_ingress_cidrs = ["10.1.0.0/16"]

# ============================================================================
# Nginx ALB Routing
# ============================================================================

enable_nginx_alb_routing = true

# ============================================================================
# Entra ID (Azure AD) Federation
# ============================================================================
create_entra_cognito_user_pool = false
cognito_entra_allow_placeholder_metadata_url = true
enable_entra_id_pre_auth_lambda  = true # Set to true when Entra ID IdP is configured
entra_id_allowed_email_domains   = []    # e.g., ["att.com", "company.com"]
entra_id_pre_auth_log_level      = "INFO"
entra_id_pre_auth_log_retention_days = 14
