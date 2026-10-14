# ============================================================================
# UNO Unified Orchestrator - Root Module Composition
# ============================================================================
# Composes all component modules and wires cross-module dependencies.
# SSM-derived values (vpc_id, private_subnet_ids, kms_key_arn) flow from
# root locals. Cross-module outputs wire Cognito → common, common → backend,
# and frontend → common.
# ============================================================================

# ============================================================================
# Cognito Authentication Component
# ============================================================================

module "cognito" {
  source = "./cognito"

  environment   = var.environment
  project_name  = local.naming_prefix
  domain_suffix = var.cognito_domain_suffix
  create_entra_user_pool      = var.create_entra_cognito_user_pool
  entra_domain_suffix         = var.cognito_entra_domain_suffix
  entra_callback_urls         = var.cognito_entra_callback_urls
  entra_logout_urls           = var.cognito_entra_logout_urls
  entra_identity_provider_name = var.cognito_entra_identity_provider_name
  entra_metadata_url          = var.cognito_entra_metadata_url
  entra_metadata_file         = var.cognito_entra_metadata_file
  allow_placeholder_entra_metadata_url = var.cognito_entra_allow_placeholder_metadata_url
  entra_idp_signout           = var.cognito_entra_idp_signout
  entra_attribute_mapping     = var.cognito_entra_attribute_mapping

  # ALB client callback/logout URLs (use control_plane_domain as primary)
  callback_urls = var.control_plane_domain != "" ? [
    "https://${var.control_plane_domain}/callback",
    "https://${var.control_plane_domain}/auth/idpresponse",
    "https://${module.common.alb_dns_name}/auth/idpresponse"
  ] : ["https://${module.common.alb_dns_name}/auth/idpresponse"]
  logout_urls = var.control_plane_domain != "" ? [
    "https://${var.control_plane_domain}",
    "https://${module.common.alb_dns_name}"
  ] : ["https://${module.common.alb_dns_name}"]

  # No client secret when using Nginx proxy for auth
  generate_client_secret = !var.enable_nginx_alb_routing

  # Frontend client (optional)
  create_frontend_client = var.create_cognito_frontend_client
  frontend_callback_urls = var.cognito_frontend_callback_urls
  frontend_logout_urls   = var.cognito_frontend_logout_urls

  # Admin user (optional)
  create_admin_user        = var.create_cognito_admin_user
  admin_email              = var.cognito_admin_email
  admin_temporary_password = var.cognito_admin_temporary_password

  # Pre-Authentication Lambda (Entra ID)
  enable_pre_auth_lambda         = var.enable_entra_id_pre_auth_lambda
  pre_auth_allowed_email_domains = var.entra_id_allowed_email_domains
  pre_auth_log_level             = var.entra_id_pre_auth_log_level
  pre_auth_log_retention_days    = var.entra_id_pre_auth_log_retention_days
  permission_boundary_arn        = var.permission_boundary_name != null ? "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.permission_boundary_name}" : null
  kms_key_arn                    = local.kms_key_arn

  # Tagging
  tags = merge(local.base_tags, { Component = "Cognito" })
}

# ============================================================================
# Frontend Component
# ============================================================================

module "frontend" {
  source = "./frontend"

  environment  = var.environment
  project_name = local.naming_prefix
  prefix       = replace(var.prefix, "-", "") # AT&T S3 pattern: no dashes (e.g., "hafuno")
  aws_region   = local.aws_region
  vpc_id       = local.vpc_id

  # S3 bucket configuration
  bucket_name   = local.frontend_bucket_name
  create_bucket = var.create_frontend_bucket
  force_destroy = var.force_destroy

  # VPC endpoint for bucket policy
  vpc_endpoint_id = var.s3_vpc_endpoint_id

  # Logging bucket
  create_logging_bucket = var.create_logging_bucket
  elb_account_id        = data.aws_elb_service_account.main.id

  # Bucket name suffix
  bucket_name_suffix = var.bucket_name_suffix

  # Tagging
  tags            = local.base_tags
  additional_tags = { Component = "Frontend" }
}

# ============================================================================
# Common/Networking Component
# ============================================================================

module "common" {
  source = "./common"

  # VPC & Network (SSM-derived)
  vpc_id             = local.vpc_id
  vpc_cidr           = local.vpc_cidr
  private_subnet_ids = local.private_subnet_ids
  kms_key_arn        = local.kms_key_arn

  # ALB configuration
  naming_prefix              = local.naming_prefix
  backend_port               = var.backend_port
  backend_health_check_path  = var.backend_health_check_path
  certificate_arn            = var.certificate_arn
  enable_deletion_protection = var.enable_deletion_protection

  # ALB/NLB access logs (from frontend module)
  # depends_on the bucket policy via frontend output to ensure policy is applied
  # before NLB tries to enable access logs
  logs_bucket_id = module.frontend.logs_bucket_id

  # Cognito authentication (from cognito module)
  enable_cognito_auth         = var.enable_cognito_auth
  cognito_user_pool_arn       = module.cognito.user_pool_arn
  cognito_user_pool_client_id = module.cognito.alb_client_id
  cognito_user_pool_domain    = module.cognito.user_pool_domain

  # NLB + PrivateLink configuration
  create_nlb_privatelink          = var.create_nlb_privatelink
  nlb_internal                    = var.nlb_internal
  nlb_create_http_listener        = var.nlb_create_http_listener
  privatelink_acceptance_required = var.privatelink_acceptance_required
  privatelink_allowed_principals  = var.privatelink_allowed_principals

  # Nginx ALB routing
  enable_nginx_alb_routing = var.enable_nginx_alb_routing
  nginx_instance_id        = var.enable_nginx_proxy ? module.proxy[0].instance_id : ""

  # Tagging
  tags            = local.base_tags
  additional_tags = { Component = "Common-Networking" }
}

# ============================================================================
# Backend Component
# ============================================================================

module "backend" {
  source = "./backend"

  # Naming & Environment
  naming_prefix = local.naming_prefix
  environment   = var.environment
  aws_region    = local.aws_region

  # VPC & Networking (SSM-derived)
  vpc_id             = local.vpc_id
  private_subnet_ids = local.private_subnet_ids

  # Cross-module: common → backend
  alb_security_group_id = module.common.alb_security_group_id
  target_group_arn      = module.common.ecs_target_group_arn
  alb_listener_arn      = module.common.https_listener_arn

  # Encryption (SSM-derived)
  kms_key_arn = local.kms_key_arn

  # Container & Task Definition
  container_image                 = var.container_image
  container_port                  = var.container_port
  task_cpu                        = var.task_cpu
  task_memory                     = var.task_memory
  desired_count                   = var.desired_count
  container_environment           = var.container_environment
  registry_credentials_secret_arn = var.registry_credentials_secret_arn

  # ECS Cluster & Capacity Provider
  instance_type          = var.instance_type
  asg_min_size           = var.asg_min_size
  asg_max_size           = var.asg_max_size
  asg_desired_capacity   = var.asg_desired_capacity
  volume_size            = var.volume_size
  ecs_log_retention_days = var.ecs_log_retention_days

  # Application Dependencies
  assets_bucket_name   = local.assets_bucket_name
  dynamodb_tables      = local.dynamodb_tables
  enable_dynamodb_pitr = var.enable_dynamodb_pitr

  # Cross-module: cognito → backend
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_region       = local.aws_region

  # AVP (Amazon Verified Permissions)
  enable_avp         = var.enable_avp
  avp_policy_store_id = var.enable_avp ? module.avp[0].policy_store_id : ""
  avp_policy_store_arn = var.enable_avp ? module.avp[0].policy_store_arn : ""

  # CORS & Proxy
  cors_origins = var.cors_origins
  http_proxy   = local.http_proxy_url
  https_proxy  = local.https_proxy_url
  no_proxy     = local.no_proxy_ssm

  # IAM Permission Boundary
  permission_boundary_name = var.permission_boundary_name

  # Tagging
  tags            = local.base_tags
  additional_tags = { Component = "Backend" }
}

# ============================================================================
# Nginx Reverse Proxy Component (Optional)
# ============================================================================

module "proxy" {
  source = "./proxy"
  count  = var.enable_nginx_proxy ? 1 : 0

  # Naming & Environment
  naming_prefix = local.naming_prefix

  # VPC & Networking
  vpc_id            = local.vpc_id
  private_subnet_id = local.private_subnet_ids[0]

  # Security
  allowed_ingress_cidrs    = var.proxy_allowed_ingress_cidrs
  permission_boundary_name = var.permission_boundary_name

  # Domain & Routing Configuration
  control_plane_domain = var.control_plane_domain
  cognito_domain       = "${module.cognito.user_pool_domain}.auth.${local.aws_region}.amazoncognito.com"

  # Frontend S3 bucket (Nginx proxies to S3)
  frontend_bucket_name = local.frontend_bucket_name
  aws_region           = local.aws_region

  # SSM Parameter Prefix (proxy reads egress proxy config from SSM)
  ssm_parameter_prefix = var.ssm_parameter_prefix

  # Proxy config from root locals (shared with backend module)
  http_proxy_url  = local.http_proxy_url
  https_proxy_url = local.https_proxy_url

  # Tagging
  tags            = local.base_tags
  additional_tags = { Component = "Proxy" }
}

# ============================================================================
# AVP (Amazon Verified Permissions) Component — Optional
# ============================================================================

module "avp" {
  source = "./avp"
  count  = var.enable_avp ? 1 : 0

  naming_prefix = local.naming_prefix
  tags          = merge(local.base_tags, { Component = "AVP" })
}
