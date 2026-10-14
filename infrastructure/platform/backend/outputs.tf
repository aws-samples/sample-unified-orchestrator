# ============================================================================
# Backend Component - Outputs
# ============================================================================

output "cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.this.id
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.this.arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.backend.name
}

output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.ecs_task.arn
}

output "ecs_security_group_id" {
  description = "Security group ID for ECS tasks"
  value       = aws_security_group.ecs_tasks.id
}

output "ecs_instance_security_group_id" {
  description = "Security group ID for ECS EC2 instances"
  value       = aws_security_group.ecs_instances.id
}

output "autoscaling_group_name" {
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.ecs.name
}

output "dynamodb_table_arns" {
  description = "Map of DynamoDB table ARNs (key => ARN)"
  value       = { for key, table in aws_dynamodb_table.tables : key => table.arn }
}

output "dynamodb_table_names" {
  description = "Map of DynamoDB table names (key => name)"
  value       = { for key, table in aws_dynamodb_table.tables : key => table.name }
}

output "ecr_repository_url" {
  description = "ECR repository URL for the backend image"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.backend.arn
}
