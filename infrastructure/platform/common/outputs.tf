# ============================================================================
# UNO Common/Networking Component - Outputs
# ============================================================================

output "alb_arn" {
  description = "ARN of the internal Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_dns_name" {
  description = "DNS name of the internal Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Canonical hosted zone ID of the ALB (for Route53 alias records)"
  value       = aws_lb.main.zone_id
}

output "alb_security_group_id" {
  description = "Security group ID of the ALB"
  value       = aws_security_group.alb.id
}

output "https_listener_arn" {
  description = "ARN of the HTTPS listener (null if no certificate_arn provided)"
  value       = var.certificate_arn != "" ? aws_lb_listener.https[0].arn : null
}

output "ecs_target_group_arn" {
  description = "ARN of the backend ECS target group"
  value       = aws_lb_target_group.backend.arn
}

# ============================================================================
# NLB Outputs
# ============================================================================

output "nlb_arn" {
  description = "ARN of the Network Load Balancer"
  value       = var.create_nlb_privatelink ? aws_lb.nlb[0].arn : null
}

output "nlb_dns_name" {
  description = "DNS name of the Network Load Balancer"
  value       = var.create_nlb_privatelink ? aws_lb.nlb[0].dns_name : null
}

output "nlb_zone_id" {
  description = "Canonical hosted zone ID of the NLB"
  value       = var.create_nlb_privatelink ? aws_lb.nlb[0].zone_id : null
}

output "nlb_target_group_arn" {
  description = "ARN of the NLB target group for ALB"
  value       = var.create_nlb_privatelink ? aws_lb_target_group.nlb_tg[0].arn : null
}

# ============================================================================
# PrivateLink Outputs
# ============================================================================

output "vpce_service_id" {
  description = "ID of the VPC Endpoint Service"
  value       = var.create_nlb_privatelink ? aws_vpc_endpoint_service.this[0].id : null
}

output "vpce_service_name" {
  description = "Service name of the VPC Endpoint Service (used by consumers)"
  value       = var.create_nlb_privatelink ? aws_vpc_endpoint_service.this[0].service_name : null
}

output "vpce_service_state" {
  description = "State of the VPC Endpoint Service"
  value       = var.create_nlb_privatelink ? aws_vpc_endpoint_service.this[0].state : null
}

# ============================================================================
# Nginx ALB Routing Outputs
# ============================================================================

output "nginx_target_group_arn" {
  description = "ARN of the Nginx proxy target group (null when disabled)"
  value       = var.enable_nginx_alb_routing ? aws_lb_target_group.nginx_proxy[0].arn : null
}
