# ============================================================================
# UNO Unified Orchestrator - Local Values
# ============================================================================

locals {
  # AWS region mapping (region code to AWS region)
  region_map = {
    useast1 = "us-east-1"
    useast2 = "us-east-2"
    uswest1 = "us-west-1"
    uswest2 = "us-west-2"
  }

  # Resolved AWS region
  aws_region = lookup(local.region_map, var.region, "us-east-1")

  # Common resource naming prefix
  naming_prefix = "${var.prefix}-${var.region}-${var.environment}"

  # ============================================================================
  # CONSOLIDATED TAG MANAGEMENT - SINGLE SOURCE OF TRUTH
  # ============================================================================

  # Base tags - Applied to ALL resources via provider default_tags
  # AT&T mandatory tags use lowercase with underscores
  base_tags = merge(
    {
      # AT&T Mandatory Tags (lowercase with underscores)
      env            = var.environment
      correlation_id = var.correlation_id
      created_by     = var.created_by
      contact_dl     = var.contact_dl
      automated_by   = var.managed_by
      purpose        = var.purpose

      # Standard Tags (PascalCase)
      ApplicationName = var.application_name
      Project         = var.project
      Repository      = var.repository

      # Operational Tags
      Prefix = var.prefix
      Region = var.region
    },
    var.additional_tags
  )

  # ============================================================================
  # SSM-DERIVED VALUES
  # ============================================================================

  # Parsed from SSM parameters (populated in ssm.tf)
  vpc_id             = data.aws_ssm_parameter.vpc_id.value
  vpc_cidr           = data.aws_vpc.selected.cidr_block
  private_subnet_ids = split(",", data.aws_ssm_parameter.private_subnet_ids.value)
  kms_key_arn        = data.aws_ssm_parameter.kms_key_arn.value

  # ============================================================================
  # PROXY CONFIGURATION (from SSM JSON)
  # ============================================================================

  proxy_config    = jsondecode(data.aws_ssm_parameter.proxy_config.value)
  http_proxy_url  = lookup(local.proxy_config, "http_proxy", "")
  https_proxy_url = lookup(local.proxy_config, "https_proxy", "")
  no_proxy_ssm    = lookup(local.proxy_config, "no_proxy", "")

  # ============================================================================
  # DYNAMODB TABLE NAMES
  # ============================================================================

  dynamodb_tables = {
    for key, suffix in var.dynamodb_table_suffixes :
    key => "${local.naming_prefix}-${suffix}"
  }

  # ============================================================================
  # AUTO-DERIVED NAMING (from prefix + region + environment)
  # ============================================================================

  # SSM write prefix — auto-derived, no need to set in tfvars
  uno_ssm_prefix = "/${var.prefix}/${var.region}/${var.environment}"

  # S3 bucket names — use control_plane_domain when set, otherwise AT&T pattern
  s3_prefix     = replace(var.prefix, "-", "")
  bucket_suffix = var.bucket_name_suffix

  frontend_bucket_name = var.control_plane_domain != "" ? var.control_plane_domain : "${local.s3_prefix}${var.environment}s3assets${local.bucket_suffix}"
  logging_bucket_name  = "${local.s3_prefix}${var.environment}s3logs${local.bucket_suffix}"

  # ============================================================================
  # S3 ASSETS BUCKET
  # ============================================================================

  assets_bucket_name = "${local.s3_prefix}${var.environment}s3assets${local.bucket_suffix}"
}
