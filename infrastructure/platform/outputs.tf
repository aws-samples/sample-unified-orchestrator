# ============================================================================
# UNO Unified Orchestrator - Root Outputs
# ============================================================================
# Aggregated outputs from all child modules for consumption by CI/CD,
# deployment scripts, and downstream systems.
# ============================================================================

# ============================================================================
# ALB Outputs (from common/infra)
# ============================================================================

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.common.alb_dns_name
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = module.common.alb_arn
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer"
  value       = module.common.alb_zone_id
}

# ============================================================================
# ECS Outputs (from backend/infra)
# ============================================================================

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = module.backend.ecs_service_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.backend.cluster_name
}

# ============================================================================
# S3 Outputs (from frontend/infra)
# ============================================================================

output "frontend_bucket_name" {
  description = "Name of the frontend S3 bucket"
  value       = module.frontend.bucket_name
}

output "assets_bucket_name" {
  description = "Name of the shared assets S3 bucket (used by UNO backend + ARA)"
  value       = aws_s3_bucket.assets.bucket
}

output "logs_bucket_id" {
  description = "ID of the ALB access logs S3 bucket"
  value       = module.frontend.logs_bucket_id
}

# ============================================================================
# Cognito Outputs (from cognito/infra)
# ============================================================================

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_app_client_id" {
  description = "Cognito App Client ID (for VITE_CLIENT_ID)"
  value       = module.cognito.alb_client_id
}

output "cognito_auth_domain" {
  description = "Cognito Auth Domain URL (for VITE_AUTH_DOMAIN)"
  value       = "https://${module.cognito.user_pool_domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_entra_user_pool_id" {
  description = "Cognito Entra-federated User Pool ID"
  value       = module.cognito.entra_user_pool_id
}

output "cognito_entra_app_client_id" {
  description = "Cognito Entra-federated App Client ID"
  value       = module.cognito.entra_alb_client_id
}

output "cognito_entra_auth_domain" {
  description = "Cognito Entra-federated Auth Domain URL"
  value       = module.cognito.entra_user_pool_domain != "" ? "https://${module.cognito.entra_user_pool_domain}.auth.${var.aws_region}.amazoncognito.com" : ""
}

output "cognito_entra_identity_provider_name" {
  description = "Cognito provider name for the Entra ID identity provider"
  value       = module.cognito.entra_identity_provider_name
}

# ============================================================================
# Proxy Outputs
# ============================================================================

output "proxy_public_ip" {
  description = "Public IP of the Nginx proxy instance"
  value       = var.enable_nginx_proxy ? module.proxy[0].public_ip : null
}

output "nginx_target_group_arn" {
  description = "ARN of the Nginx proxy ALB target group"
  value       = module.common.nginx_target_group_arn
}

# ============================================================================
# NLB Outputs
# ============================================================================

output "nlb_arn" {
  description = "ARN of the Network Load Balancer"
  value       = module.common.nlb_arn
}

output "nlb_dns_name" {
  description = "DNS name of the Network Load Balancer"
  value       = module.common.nlb_dns_name
}

output "nlb_zone_id" {
  description = "Canonical hosted zone ID of the NLB"
  value       = module.common.nlb_zone_id
}

output "nlb_target_group_arn" {
  description = "ARN of the NLB target group for ALB"
  value       = module.common.nlb_target_group_arn
}

# ============================================================================
# PrivateLink Outputs
# ============================================================================

output "vpce_service_id" {
  description = "ID of the VPC Endpoint Service"
  value       = module.common.vpce_service_id
}

output "vpce_service_name" {
  description = "Service name of the VPC Endpoint Service"
  value       = module.common.vpce_service_name
}

output "vpce_service_state" {
  description = "State of the VPC Endpoint Service"
  value       = module.common.vpce_service_state
}

# ---------- AVP Outputs ----------

output "avp_policy_store_id" {
  description = "AVP policy store ID (null if AVP disabled)"
  value       = var.enable_avp ? module.avp[0].policy_store_id : null
}
