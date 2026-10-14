# ============================================================================
# Proxy Component - Outputs
# ============================================================================

output "instance_id" {
  description = "EC2 instance ID of the Nginx reverse proxy"
  value       = aws_instance.nginx_proxy.id
}

output "public_ip" {
  description = "Public IP address of the Nginx reverse proxy instance"
  value       = aws_instance.nginx_proxy.public_ip
}

output "security_group_id" {
  description = "Security group ID of the Nginx reverse proxy"
  value       = aws_security_group.nginx_proxy.id
}
