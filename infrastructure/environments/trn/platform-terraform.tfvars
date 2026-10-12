# ============================================================================
# UNO Unified Orchestrator - TRN Environment Configuration
# ============================================================================

# ============================================================================
# Common Variables
# ============================================================================

prefix               = "haf-uno"
environment          = "trn"
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
desired_count             = 1

# Container environment — production mode
container_environment = [
  { name = "APP_ENV", value = "production" }
]

# ============================================================================
# Frontend
# ============================================================================

frontend_bucket_name   = "hafunotrns3assets01"
create_frontend_bucket = true
force_destroy          = true
create_logging_bucket  = true

# ============================================================================
# ALB
# ============================================================================

certificate_arn            = ""  # e.g. "arn:aws:acm:us-east-1:123456789012:certificate/<id>" — supply the ACM cert ARN at deploy time
enable_deletion_protection = false
enable_cognito_auth        = true
cognito_domain_suffix      = "auth"

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
# NLB & PrivateLink
# ============================================================================

create_nlb_privatelink = false

# ============================================================================
# Nginx ALB Routing
# ============================================================================

enable_nginx_alb_routing = false
