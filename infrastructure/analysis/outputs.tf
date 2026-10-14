output "resource_prefix" {
  description = "Resource naming prefix"
  value       = local.resource_prefix
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.backend.name
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.ecs_task.arn
}

output "ecs_security_group_id" {
  description = "ECS tasks security group ID"
  value       = aws_security_group.ecs_tasks.id
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.backend.name
}

output "target_group_arn" {
  description = "Target group ARN (if ALB integration enabled)"
  value       = var.enable_alb_integration ? aws_lb_target_group.backend[0].arn : null
}

output "listener_rule_arn" {
  description = "ALB listener rule ARN (if ALB integration enabled)"
  value       = var.enable_alb_integration ? aws_lb_listener_rule.backend[0].arn : null
}

output "cloudwatch_logs_kms_key_arn" {
  description = "KMS key ARN used for CloudWatch Logs encryption"
  value       = aws_kms_key.cloudwatch_logs.arn
}

# ---------- Auth Outputs ----------

output "auth_mode" {
  description = "Authentication mode (cognito or dev)"
  value       = var.auth_mode
}

# ---------- DynamoDB Table Outputs ----------

output "atx_assessments_table" {
  description = "DynamoDB table name for ATX assessments"
  value       = var.dynamodb_tables["atx_assessments"]
}

output "atx_processing_tasks_table" {
  description = "DynamoDB table name for ATX processing tasks"
  value       = var.dynamodb_tables["atx_processing_tasks"]
}

# ---------- Computed Bucket Name Outputs ----------

output "s3_ara_bucket_name" {
  description = "ARA assets S3 bucket name"
  value       = aws_s3_bucket.ara_assets.bucket
}

output "s3_uno_dp_bucket" {
  description = "S3 bucket name for UNO data plane assets"
  value       = local.s3_uno_dp_bucket
  sensitive   = true
}

# ---------- AVP Outputs ----------

output "avp_policy_store_id" {
  description = "AVP policy store ID from UNO shared store (null if AVP disabled)"
  value       = var.enable_avp ? local.avp_policy_store_id : null
  sensitive   = true
}
