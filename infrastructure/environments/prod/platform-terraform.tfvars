# ============================================================================
# UNO Unified Orchestrator - Prod Environment Configuration
# ============================================================================

# ============================================================================
# Common Variables
# ============================================================================

prefix               = "haf-uno"
environment          = "prod"
region               = "useast1"
ssm_parameter_prefix = "/haf-uno/useast1/prod"
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
enable_deletion_protection = true
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

create_nlb_privatelink = true

# ============================================================================
# Nginx ALB Routing
# ============================================================================

enable_nginx_alb_routing = false
