output "policy_store_id" {
  description = "AVP policy store ID"
  value       = aws_verifiedpermissions_policy_store.this.id
}

output "policy_store_arn" {
  description = "AVP policy store ARN"
  value       = aws_verifiedpermissions_policy_store.this.arn
}
