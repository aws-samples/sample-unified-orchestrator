# ============================================================================
# Frontend Component - Outputs
# ============================================================================

output "bucket_id" {
  description = "Frontend S3 bucket ID"
  value       = local.frontend_bucket_id
}

output "bucket_arn" {
  description = "Frontend S3 bucket ARN"
  value       = local.frontend_bucket_arn
}

output "bucket_name" {
  description = "Frontend S3 bucket name"
  value       = local.frontend_bucket_name
}

output "logs_bucket_id" {
  description = "Logs S3 bucket ID (depends on bucket policy being applied)"
  value       = var.create_logging_bucket ? aws_s3_bucket.logs[0].id : ""
  depends_on  = [aws_s3_bucket_policy.logs]
}

output "logs_bucket_arn" {
  description = "Logs S3 bucket ARN"
  value       = var.create_logging_bucket ? aws_s3_bucket.logs[0].arn : ""
}
