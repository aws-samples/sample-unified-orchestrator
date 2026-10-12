# -----------------------------------------------------------------------------
# Cognito Authentication Component — Outputs
# -----------------------------------------------------------------------------

# Data source for region (used in endpoint URL construction)
data "aws_region" "current" {}

output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

output "user_pool_domain" {
  description = "Cognito User Pool domain"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "entra_user_pool_id" {
  description = "Cognito Entra-federated User Pool ID"
  value       = var.create_entra_user_pool ? aws_cognito_user_pool.entra[0].id : ""
}

output "entra_user_pool_arn" {
  description = "Cognito Entra-federated User Pool ARN"
  value       = var.create_entra_user_pool ? aws_cognito_user_pool.entra[0].arn : ""
}

output "entra_user_pool_domain" {
  description = "Cognito Entra-federated User Pool domain"
  value       = var.create_entra_user_pool ? aws_cognito_user_pool_domain.entra[0].domain : ""
}

output "entra_identity_provider_name" {
  description = "Provider name configured for the Entra ID identity provider"
  value       = var.create_entra_user_pool ? aws_cognito_identity_provider.entra[0].provider_name : ""
}

output "alb_client_id" {
  description = "Cognito User Pool Client ID for ALB"
  value       = aws_cognito_user_pool_client.alb.id
}

output "alb_client_secret" {
  description = "Cognito User Pool Client Secret for ALB"
  value       = aws_cognito_user_pool_client.alb.client_secret
  sensitive   = true
}

output "frontend_client_id" {
  description = "Cognito User Pool Client ID for Frontend SPA"
  value       = var.create_frontend_client ? aws_cognito_user_pool_client.frontend[0].id : ""
}

output "entra_alb_client_id" {
  description = "Cognito Entra-federated User Pool Client ID for ALB"
  value       = var.create_entra_user_pool ? aws_cognito_user_pool_client.entra_alb[0].id : ""
}

output "entra_alb_client_secret" {
  description = "Cognito Entra-federated User Pool Client Secret for ALB"
  value       = var.create_entra_user_pool ? aws_cognito_user_pool_client.entra_alb[0].client_secret : ""
  sensitive   = true
}

output "issuer_url" {
  description = "OIDC Issuer URL"
  value       = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "entra_issuer_url" {
  description = "OIDC issuer URL for the Entra-federated user pool"
  value       = var.create_entra_user_pool ? "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.entra[0].id}" : ""
}

output "authorization_endpoint" {
  description = "Authorization endpoint"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/authorize"
}

output "entra_authorization_endpoint" {
  description = "Authorization endpoint for the Entra-federated user pool"
  value       = var.create_entra_user_pool ? "https://${aws_cognito_user_pool_domain.entra[0].domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/authorize" : ""
}

output "token_endpoint" {
  description = "Token endpoint"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/token"
}

output "entra_token_endpoint" {
  description = "Token endpoint for the Entra-federated user pool"
  value       = var.create_entra_user_pool ? "https://${aws_cognito_user_pool_domain.entra[0].domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/token" : ""
}

output "user_info_endpoint" {
  description = "User info endpoint"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/userInfo"
}

output "entra_user_info_endpoint" {
  description = "User info endpoint for the Entra-federated user pool"
  value       = var.create_entra_user_pool ? "https://${aws_cognito_user_pool_domain.entra[0].domain}.auth.${data.aws_region.current.region}.amazoncognito.com/oauth2/userInfo" : ""
}


# -----------------------------------------------------------------------------
# Pre-Authentication Lambda Outputs
# -----------------------------------------------------------------------------

output "pre_auth_lambda_arn" {
  description = "ARN of the pre-authentication Lambda function"
  value       = var.enable_pre_auth_lambda ? aws_lambda_function.pre_auth[0].arn : ""
}

output "pre_auth_lambda_name" {
  description = "Name of the pre-authentication Lambda function"
  value       = var.enable_pre_auth_lambda ? aws_lambda_function.pre_auth[0].function_name : ""
}
