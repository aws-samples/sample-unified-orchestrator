# ============================================================================
# UNO Unified Orchestrator - SSM Parameter Store Integration
# ============================================================================
# Centralizes all SSM parameter reads (base infrastructure) and writes
# (UNO-owned outputs) following the HAF dual-prefix pattern:
#   - ssm_parameter_prefix: READ base infra values (VPC, KMS)
#   - uno_ssm_prefix:       WRITE UNO deployment outputs (ALB, Cognito)
#
# SECURITY: All SSM parameter writes use SecureString with KMS encryption
# ============================================================================

# ============================================================================
# DATA SOURCES — Base Infrastructure Reads
# ============================================================================

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameters are managed by the platform team — type is not user-controlled
data "aws_ssm_parameter" "vpc_id" {
  name = "${var.ssm_parameter_prefix}/vpc/vpc-id"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameters are managed by the platform team — type is not user-controlled
data "aws_ssm_parameter" "private_subnet_ids" {
  name = "${var.ssm_parameter_prefix}/vpc/private-subnet-ids"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameters are managed by the platform team — type is not user-controlled
data "aws_ssm_parameter" "kms_key_arn" {
  name = "${var.ssm_parameter_prefix}/kms/key-arn"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameters are managed by the platform team — type is not user-controlled
data "aws_ssm_parameter" "proxy_config" {
  name = "${var.ssm_parameter_prefix}/egress/proxy-config"
}

# ============================================================================
# DATA SOURCES — Security Group Lookup
# ============================================================================

data "aws_vpc" "selected" {
  id = data.aws_ssm_parameter.vpc_id.value
}

# ============================================================================
# DATA SOURCES — AWS Account & ELB Service Account
# ============================================================================

data "aws_caller_identity" "current" {}

data "aws_elb_service_account" "main" {}

# ============================================================================
# SSM PARAMETER WRITES — ALB Outputs (Common-Networking)
# All writes use SecureString with KMS encryption per Requirement 11.10
# ============================================================================

resource "aws_ssm_parameter" "alb_arn" {
  name        = "${local.uno_ssm_prefix}/alb/arn"
  description = "UNO Application Load Balancer ARN"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.common.alb_arn

  tags = {
    Name      = "${local.uno_ssm_prefix}/alb/arn"
    Component = "Common-Networking"
  }
}

resource "aws_ssm_parameter" "alb_dns_name" {
  name        = "${local.uno_ssm_prefix}/alb/dns-name"
  description = "UNO Application Load Balancer DNS name"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.common.alb_dns_name

  tags = {
    Name      = "${local.uno_ssm_prefix}/alb/dns-name"
    Component = "Common-Networking"
  }
}

resource "aws_ssm_parameter" "alb_https_listener_arn" {
  count = var.certificate_arn != "" ? 1 : 0

  name        = "${local.uno_ssm_prefix}/alb/https-listener-arn"
  description = "UNO ALB HTTPS listener ARN"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.common.https_listener_arn

  tags = {
    Name      = "${local.uno_ssm_prefix}/alb/https-listener-arn"
    Component = "Common-Networking"
  }
}

resource "aws_ssm_parameter" "alb_target_group_arn" {
  name        = "${local.uno_ssm_prefix}/alb/target-group-arn"
  description = "UNO ALB target group ARN"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.common.ecs_target_group_arn

  tags = {
    Name      = "${local.uno_ssm_prefix}/alb/target-group-arn"
    Component = "Common-Networking"
  }
}

# ============================================================================
# SSM PARAMETER WRITES — Cognito Outputs
# All writes use SecureString with KMS encryption per Requirement 12.9, 12.10
# ============================================================================

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name        = "${local.uno_ssm_prefix}/cognito/user-pool-id"
  description = "UNO Cognito User Pool ID"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.user_pool_id

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/user-pool-id"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_alb_client_id" {
  name        = "${local.uno_ssm_prefix}/cognito/alb-client-id"
  description = "UNO Cognito ALB Client ID"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.alb_client_id

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/alb-client-id"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "alb_security_group_id" {
  name        = "${local.uno_ssm_prefix}/alb/security-group-id"
  description = "UNO ALB Security Group ID"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.common.alb_security_group_id

  tags = {
    Name      = "${local.uno_ssm_prefix}/alb/security-group-id"
    Component = "Common-Networking"
  }
}

resource "aws_ssm_parameter" "cognito_user_pool_arn" {
  name        = "${local.uno_ssm_prefix}/cognito/user-pool-arn"
  description = "UNO Cognito User Pool ARN"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.user_pool_arn

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/user-pool-arn"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_user_pool_domain" {
  name        = "${local.uno_ssm_prefix}/cognito/user-pool-domain"
  description = "UNO Cognito User Pool Domain"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.user_pool_domain

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/user-pool-domain"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_entra_user_pool_id" {
  count = var.create_entra_cognito_user_pool ? 1 : 0

  name        = "${local.uno_ssm_prefix}/cognito/entra-user-pool-id"
  description = "UNO Cognito Entra-federated User Pool ID"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.entra_user_pool_id

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/entra-user-pool-id"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_entra_alb_client_id" {
  count = var.create_entra_cognito_user_pool ? 1 : 0

  name        = "${local.uno_ssm_prefix}/cognito/entra-alb-client-id"
  description = "UNO Cognito Entra-federated ALB Client ID"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.entra_alb_client_id

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/entra-alb-client-id"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_entra_user_pool_arn" {
  count = var.create_entra_cognito_user_pool ? 1 : 0

  name        = "${local.uno_ssm_prefix}/cognito/entra-user-pool-arn"
  description = "UNO Cognito Entra-federated User Pool ARN"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.entra_user_pool_arn

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/entra-user-pool-arn"
    Component = "Cognito"
  }
}

resource "aws_ssm_parameter" "cognito_entra_user_pool_domain" {
  count = var.create_entra_cognito_user_pool ? 1 : 0

  name        = "${local.uno_ssm_prefix}/cognito/entra-user-pool-domain"
  description = "UNO Cognito Entra-federated User Pool Domain"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = module.cognito.entra_user_pool_domain

  tags = {
    Name      = "${local.uno_ssm_prefix}/cognito/entra-user-pool-domain"
    Component = "Cognito"
  }
}

# ============================================================================
# SSM PARAMETER WRITES — DynamoDB Table Names
# Single JSON parameter containing all table names for cross-repo consumption
# ============================================================================

resource "aws_ssm_parameter" "dynamodb_tables" {
  name        = "${local.uno_ssm_prefix}/dynamodb/tables"
  description = "UNO DynamoDB table names (JSON map)"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value = jsonencode({
    for key, table in module.backend.dynamodb_table_names :
    key => table
  })

  tags = {
    Name      = "${local.uno_ssm_prefix}/dynamodb/tables"
    Component = "Backend"
  }
}

# ============================================================================
# SSM PARAMETER WRITES — Shared Infrastructure (consumed by ARA)
# ============================================================================

resource "aws_ssm_parameter" "frontend_bucket_name" {
  name        = "${local.uno_ssm_prefix}/s3/frontend-bucket-name"
  description = "UNO frontend S3 bucket name (also used as ARA data plane bucket)"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = local.frontend_bucket_name

  tags = {
    Name      = "${local.uno_ssm_prefix}/s3/frontend-bucket-name"
    Component = "Frontend"
  }
}

resource "aws_ssm_parameter" "assets_bucket_name" {
  name        = "${local.uno_ssm_prefix}/s3/assets-bucket-name"
  description = "Shared assets S3 bucket name (used by UNO backend + ARA)"
  type        = "SecureString"
  key_id      = local.kms_key_arn
  value       = aws_s3_bucket.assets.bucket

  tags = {
    Name      = "${local.uno_ssm_prefix}/s3/assets-bucket-name"
    Component = "Assets"
  }
}
