# ============================================================================
# UNO Common/Networking Component - Main
# ============================================================================
# Creates the internal Application Load Balancer and associated resources
# using ONLY native aws_* resources. No external Terraform modules.
#
# Resources:
#   - aws_lb (internal ALB in private subnets)
#   - aws_security_group (ALB SG — inbound HTTPS from VPC CIDR)
#   - aws_lb_target_group (backend target group with health check)
#   - aws_lb_listener (HTTP→HTTPS redirect)
#   - aws_lb_listener (HTTPS forward, conditional on certificate_arn)
# ============================================================================

locals {
  merged_tags = merge(var.tags, var.additional_tags)
}

# ============================================================================
# ALB SECURITY GROUP
# ============================================================================

#checkov:skip=CKV2_AWS_5:Security group is attached to the ALB resource below
resource "aws_security_group" "alb" {
  name        = "${var.naming_prefix}-alb-sg"
  description = "Security group for UNO internal ALB"
  vpc_id      = var.vpc_id

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-alb-sg"
  })
}

# Inbound HTTPS (443) from VPC CIDR
resource "aws_security_group_rule" "alb_ingress_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.alb.id
  description       = "Allow HTTPS from VPC CIDR"
}

# Inbound HTTP (80) from VPC CIDR for redirect
resource "aws_security_group_rule" "alb_ingress_http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.alb.id
  description       = "Allow HTTP from VPC CIDR (redirects to HTTPS)"
}

# Egress to backend target group port
resource "aws_security_group_rule" "alb_egress_backend" {
  type              = "egress"
  from_port         = var.backend_port
  to_port           = var.backend_port
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.alb.id
  description       = "Allow egress to backend on container port"
}

# Egress to Nginx proxy on port 80 (when Nginx ALB routing is enabled)
resource "aws_security_group_rule" "alb_egress_nginx" {
  count             = var.enable_nginx_alb_routing ? 1 : 0
  type              = "egress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = [var.vpc_cidr]
  security_group_id = aws_security_group.alb.id
  description       = "Allow egress to Nginx proxy on port 80"
}

# Egress HTTPS for Cognito authentication endpoint callbacks
resource "aws_security_group_rule" "alb_egress_https" {
  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.alb.id
  description       = "Allow HTTPS egress for Cognito auth and health checks"
}

# ============================================================================
# APPLICATION LOAD BALANCER
# ============================================================================

#checkov:skip=CKV_AWS_150:Deletion protection is configurable via variable
#checkov:skip=CKV_AWS_91:Access logging is configured when logs_bucket_id is provided
#checkov:skip=CKV2_AWS_28:WAF association is managed externally
resource "aws_lb" "main" {
  name               = "${var.naming_prefix}-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.private_subnet_ids

  enable_deletion_protection = var.enable_deletion_protection
  drop_invalid_header_fields = true

  access_logs {
    bucket  = var.logs_bucket_id
    prefix  = "alb-logs"
    enabled = true
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-alb"
  })
}

# ============================================================================
# TARGET GROUP
# ============================================================================

resource "aws_lb_target_group" "backend" {
  name        = "${var.naming_prefix}-backend-tg"
  port        = var.backend_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    interval            = 30
    path                = var.backend_health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 6
    matcher             = "200-299"
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-backend-tg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# ============================================================================
# NGINX PROXY TARGET GROUP (gated by enable_nginx_alb_routing)
# ============================================================================

resource "aws_lb_target_group" "nginx_proxy" {
  count       = var.enable_nginx_alb_routing ? 1 : 0
  name        = "${var.naming_prefix}-nginx-tg"
  port        = 80
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    protocol            = "HTTP"
    path                = "/health"
    port                = "80"
    matcher             = "200"
    interval            = 30
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 6
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-nginx-tg"
  })
}

resource "aws_lb_target_group_attachment" "nginx_proxy" {
  count            = var.enable_nginx_alb_routing ? 1 : 0
  target_group_arn = aws_lb_target_group.nginx_proxy[0].arn
  target_id        = var.nginx_instance_id
  port             = 80
}

# ============================================================================
# LISTENERS
# ============================================================================

# HTTP Listener — redirect to HTTPS when cert is available, otherwise forward to backend
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP" # nosemgrep: terraform.aws.security.insecure-load-balancer-tls-version.insecure-load-balancer-tls-version  — HTTP listener redirects to HTTPS when cert is present

  default_action {
    type             = var.certificate_arn != "" ? "redirect" : "forward"
    target_group_arn = var.certificate_arn != "" ? null : aws_lb_target_group.backend.arn

    dynamic "redirect" {
      for_each = var.certificate_arn != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-http-listener"
  })
}

# HTTPS Listener — conditional default action:
#   - When Cognito auth enabled: fixed-response 404 (rules handle routing)
#   - When Cognito auth disabled: forward to backend (existing behavior)
#checkov:skip=CKV_AWS_103:SSL policy uses TLS 1.2+ as configured
resource "aws_lb_listener" "https" {
  count = var.certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  # When Cognito auth or Nginx routing is enabled, default to 404 — listener rules handle all routing
  dynamic "default_action" {
    for_each = (var.enable_cognito_auth || var.enable_nginx_alb_routing) ? [1] : []
    content {
      type = "fixed-response"

      fixed_response {
        content_type = "text/plain"
        message_body = "Not Found"
        status_code  = "404"
      }
    }
  }

  # When neither Cognito auth nor Nginx routing is enabled, forward to backend
  dynamic "default_action" {
    for_each = (var.enable_cognito_auth || var.enable_nginx_alb_routing) ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.backend.arn
    }
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-https-listener"
  })
}

# ============================================================================
# LISTENER RULES — Cognito Authentication (when enabled)
# ============================================================================

# Priority 2: Redirect trailing slash paths to index.html (no Cognito auth)
resource "aws_lb_listener_rule" "trailing_slash_redirect" {
  count = var.certificate_arn != "" && var.enable_cognito_auth ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 2

  action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      host        = "#{host}"
      path        = "/#{path}index.html"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }

  condition {
    path_pattern {
      values = ["*/"]
    }
  }
}

# Priority 3: Static assets with Cognito auth → forward to S3 target group
resource "aws_lb_listener_rule" "static_assets" {
  count = var.certificate_arn != "" && var.enable_cognito_auth ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 3

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = var.cognito_user_pool_arn
      user_pool_client_id        = var.cognito_user_pool_client_id
      user_pool_domain           = var.cognito_user_pool_domain
      on_unauthenticated_request = "authenticate"
      session_cookie_name        = "AWSELBAuthSessionCookie"
      session_timeout            = 604800
      scope                      = "openid"
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/static/*", "/*.js", "/*.css", "/*.png", "/assets/*"]
    }
  }
}

# Priority 50: API route with Cognito authentication
resource "aws_lb_listener_rule" "api_cognito" {
  count = var.certificate_arn != "" && var.enable_cognito_auth ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 50

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = var.cognito_user_pool_arn
      user_pool_client_id        = var.cognito_user_pool_client_id
      user_pool_domain           = var.cognito_user_pool_domain
      on_unauthenticated_request = "authenticate"
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1/*"]
    }
  }
}

# SPA catch-all with Cognito authentication → forward to S3 with URL rewrite
resource "aws_lb_listener_rule" "spa_catchall_cognito" {
  count = var.certificate_arn != "" && var.enable_cognito_auth ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  action {
    type  = "authenticate-cognito"
    order = 1

    authenticate_cognito {
      user_pool_arn              = var.cognito_user_pool_arn
      user_pool_client_id        = var.cognito_user_pool_client_id
      user_pool_domain           = var.cognito_user_pool_domain
      on_unauthenticated_request = "authenticate"
      session_cookie_name        = "AWSELBAuthSessionCookie"
      session_timeout            = 604800
      scope                      = "openid"
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  transform {
    type = "url-rewrite"
    url_rewrite_config {
      rewrite {
        regex   = "^/.*$"
        replace = "/index.html"
      }
    }
  }
}

# ============================================================================
# LISTENER RULES — Nginx ALB Routing (when enabled)
# Priority layout (shared ALB with ARA):
#   100  = ARA /api/v1/ara/*  (managed by ARA Terraform)
#   1000 = UNO /api/v1/*      (API routes → Backend ECS)
#   2000 = UNO /*             (catch-all → Nginx proxy)
# ============================================================================

# Priority 1000: API routes → Backend ECS
resource "aws_lb_listener_rule" "nginx_api_routes" {
  count        = var.certificate_arn != "" && var.enable_nginx_alb_routing ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 1000

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/v1/*"]
    }
  }

  tags = local.merged_tags
}

# Priority 2000: /* → Nginx (all non-API traffic goes to Nginx)
resource "aws_lb_listener_rule" "nginx_spa_catchall" {
  count        = var.certificate_arn != "" && var.enable_nginx_alb_routing ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 2000

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.nginx_proxy[0].arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }

  tags = local.merged_tags
}

# ============================================================================
# NETWORK LOAD BALANCER + PRIVATELINK (optional — gated by create_nlb_privatelink)
# ============================================================================

#checkov:skip=CKV_AWS_91:Access logging is configured below
resource "aws_lb" "nlb" {
  #checkov:skip=CKV2_AWS_20:NLB is Layer 4 (TCP) — HTTP-to-HTTPS redirect is not applicable
  count = var.create_nlb_privatelink ? 1 : 0

  name                             = "${var.naming_prefix}-nlb"
  internal                         = var.nlb_internal
  load_balancer_type               = "network"
  subnets                          = var.private_subnet_ids
  enable_deletion_protection       = var.enable_deletion_protection
  enable_cross_zone_load_balancing = true

  access_logs {
    bucket  = var.logs_bucket_id
    prefix  = "nlb-logs"
    enabled = true
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-nlb"
  })
}

resource "aws_lb_target_group" "nlb_tg" {
  count = var.create_nlb_privatelink ? 1 : 0

  name        = "${var.naming_prefix}-nlb-tg"
  port        = 443
  protocol    = "TCP"
  target_type = "alb"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    protocol            = "HTTPS"
    port                = "443"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-nlb-tg"
  })
}

resource "aws_lb_target_group_attachment" "nlb_to_alb" {
  count = var.create_nlb_privatelink ? 1 : 0

  target_group_arn = aws_lb_target_group.nlb_tg[0].arn
  target_id        = aws_lb.main.arn
  port             = 443

  depends_on = [aws_lb_listener.https]
}

resource "aws_lb_listener" "nlb_https" {
  count = var.create_nlb_privatelink ? 1 : 0

  load_balancer_arn = aws_lb.nlb[0].arn
  port              = 443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.nlb_tg[0].arn
  }

  tags = local.merged_tags
}

resource "aws_lb_listener" "nlb_http" {
  count = var.create_nlb_privatelink && var.nlb_create_http_listener ? 1 : 0

  load_balancer_arn = aws_lb.nlb[0].arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.nlb_tg[0].arn
  }

  tags = local.merged_tags
}

resource "aws_vpc_endpoint_service" "this" {
  count = var.create_nlb_privatelink ? 1 : 0

  acceptance_required        = var.privatelink_acceptance_required
  network_load_balancer_arns = [aws_lb.nlb[0].arn]

  tags = merge(local.merged_tags, {
    Name = "${var.naming_prefix}-vpce-svc"
  })
}

resource "aws_vpc_endpoint_service_allowed_principal" "this" {
  for_each = var.create_nlb_privatelink ? toset(var.privatelink_allowed_principals) : toset([])

  vpc_endpoint_service_id = aws_vpc_endpoint_service.this[0].id
  principal_arn           = each.value
}
