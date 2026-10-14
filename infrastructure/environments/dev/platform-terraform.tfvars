# ============================================================================
# UNO Unified Orchestrator - Dev Environment Configuration
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

container_image           = "public.ecr.aws/nginx/nginx:stable-alpine"
container_port            = 8000
backend_port              = 8000
backend_health_check_path = "/health"
task_cpu                  = "512"
task_memory               = "1024"
desired_count             = 2

# ============================================================================
# Frontend
# ============================================================================

create_frontend_bucket = true
force_destroy          = false
create_logging_bucket  = true

# ============================================================================
# ALB
# ============================================================================

certificate_arn            = ""
enable_deletion_protection = false
enable_cognito_auth        = false   # Requires certificate_arn — set to true when HTTPS is configured
cognito_domain_suffix      = "auth"

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
control_plane_domain        = ""
proxy_allowed_ingress_cidrs = []

# ============================================================================
# NLB & PrivateLink
# ============================================================================

create_nlb_privatelink = false

# ============================================================================
# Nginx ALB Routing
# ============================================================================

enable_nginx_alb_routing = false

# ============================================================================
# Entra ID (Azure AD) Federation
# ============================================================================
create_entra_cognito_user_pool = true
cognito_entra_allow_placeholder_metadata_url = true
enable_entra_id_pre_auth_lambda  = true # Set to true when Entra ID IdP is configured
entra_id_allowed_email_domains   = []    # e.g., ["att.com", "company.com"]
entra_id_pre_auth_log_level      = "INFO"
entra_id_pre_auth_log_retention_days = 14
