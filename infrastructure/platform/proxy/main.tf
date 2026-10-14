# ============================================================================
# Proxy Component - Main Infrastructure
# Nginx reverse proxy EC2 instance in a private subnet (uses proxy for internet)
# ============================================================================

locals {
  all_tags = merge(var.tags, var.additional_tags)

  # Permission boundary ARN (null when not provided)
  permission_boundary_arn = var.permission_boundary_name != null ? "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/${var.permission_boundary_name}" : null

  # Proxy config — prefer values passed from root locals, fall back to SSM
  proxy_config    = jsondecode(data.aws_ssm_parameter.proxy_config.value)
  http_proxy_url  = var.http_proxy_url != "" ? var.http_proxy_url : lookup(local.proxy_config, "http_proxy", "")
  https_proxy_url = var.https_proxy_url != "" ? var.https_proxy_url : lookup(local.proxy_config, "https_proxy", "")
  no_proxy_ssm    = lookup(local.proxy_config, "no_proxy", "")
  no_proxy_base   = "169.254.169.254,169.254.170.2,localhost,127.0.0.1,.amazonaws.com,.transform-custom.us-east-1.api.aws"
  no_proxy_list   = var.no_proxy_list != "" ? var.no_proxy_list : (local.no_proxy_ssm != "" ? "${local.no_proxy_base},${local.no_proxy_ssm}" : local.no_proxy_base)
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

# ============================================================================
# SSM DATA SOURCE — Egress Proxy Configuration
# ============================================================================

data "aws_ssm_parameter" "proxy_config" {
  name = "${var.ssm_parameter_prefix}/egress/proxy-config"
}

# ============================================================================
# IAM - EC2 INSTANCE ROLE (SSM Access)
# ============================================================================

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "nginx_proxy" {
  name                 = "${var.naming_prefix}-nginx-proxy-role"
  assume_role_policy   = data.aws_iam_policy_document.ec2_assume_role.json
  permissions_boundary = local.permission_boundary_arn

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-nginx-proxy-role"
  })
}

resource "aws_iam_role_policy_attachment" "nginx_proxy_ssm" {
  role       = aws_iam_role.nginx_proxy.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "nginx_proxy" {
  name = "${var.naming_prefix}-nginx-proxy-profile"
  role = aws_iam_role.nginx_proxy.name

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-nginx-proxy-profile"
  })
}

# ============================================================================
# SECURITY GROUP - Nginx Proxy
# ============================================================================

resource "aws_security_group" "nginx_proxy" {
  name        = "${var.naming_prefix}-nginx-proxy-sg"
  description = "Security group for Nginx reverse proxy"
  vpc_id      = var.vpc_id

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-nginx-proxy-sg"
  })
}

# Inbound: HTTP (port 80) from allowed CIDRs
resource "aws_security_group_rule" "ingress_http" {
  count             = length(var.allowed_ingress_cidrs) > 0 ? 1 : 0
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = var.allowed_ingress_cidrs
  security_group_id = aws_security_group.nginx_proxy.id
  description       = "Allow HTTP inbound from allowed CIDRs"
}

# Inbound: HTTPS (port 443) from allowed CIDRs
resource "aws_security_group_rule" "ingress_https" {
  count             = length(var.allowed_ingress_cidrs) > 0 ? 1 : 0
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = var.allowed_ingress_cidrs
  security_group_id = aws_security_group.nginx_proxy.id
  description       = "Allow HTTPS inbound from allowed CIDRs"
}

# Outbound: All traffic
resource "aws_security_group_rule" "egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.nginx_proxy.id
  description       = "Allow all outbound traffic"
}

# ============================================================================
# AMI DATA SOURCE - Amazon Linux 2023
# ============================================================================

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ============================================================================
# EC2 INSTANCE - Nginx Reverse Proxy
# ============================================================================

resource "aws_instance" "nginx_proxy" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = var.private_subnet_id
  vpc_security_group_ids = [aws_security_group.nginx_proxy.id]
  iam_instance_profile   = aws_iam_instance_profile.nginx_proxy.name
  monitoring             = true
  ebs_optimized          = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size = var.root_volume_size
    encrypted   = true
  }

  user_data = base64encode(templatefile("${path.module}/nginx.conf.tpl", {
    control_plane_domain = var.control_plane_domain
    cognito_domain       = var.cognito_domain
    http_proxy_url       = local.http_proxy_url
    https_proxy_url      = local.https_proxy_url
    no_proxy_list        = local.no_proxy_list
    frontend_bucket_name = var.frontend_bucket_name
    aws_region           = var.aws_region
  }))

  tags = merge(local.all_tags, { Name = "${var.naming_prefix}-nginx-proxy-vm" })
}
