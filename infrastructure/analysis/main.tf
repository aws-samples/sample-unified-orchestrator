terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.tags
  }
}

data "aws_caller_identity" "current" {}

# checkov:skip=CKV2_AWS_34:AWS-managed public SSM parameter — type is String by design, not user-controlled
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

# ---------- SSM Reads — UNO shared resources ----------

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_alb_listener_arn" {
  count = var.enable_alb_integration ? 1 : 0
  name  = var.uno_ssm_prefix != "" ? "${var.uno_ssm_prefix}/alb/https-listener-arn" : "/haf-uno/useast1/${var.environment}/alb/https-listener-arn"
}

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_alb_security_group_id" {
  count = var.enable_alb_integration ? 1 : 0
  name  = var.uno_ssm_prefix != "" ? "${var.uno_ssm_prefix}/alb/security-group-id" : "/haf-uno/useast1/${var.environment}/alb/security-group-id"
}

# ---------- SSM Reads — Base Infrastructure ----------

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameter — type is managed by platform team
data "aws_ssm_parameter" "base_vpc_id" {
  name = "${local.base_ssm_resolved_prefix}/vpc/vpc-id"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameter — type is managed by platform team
data "aws_ssm_parameter" "base_private_subnet_ids" {
  name = "${local.base_ssm_resolved_prefix}/vpc/private-subnet-ids"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameter — type is managed by platform team
data "aws_ssm_parameter" "base_proxy_config" {
  name = "${local.base_ssm_resolved_prefix}/egress/proxy-config"
}

# checkov:skip=CKV2_AWS_34:Base infrastructure SSM parameter — type is managed by platform team
data "aws_ssm_parameter" "base_kms_key_arn" {
  name = "${local.base_ssm_resolved_prefix}/kms/key-arn"
}

# ---------- SSM Reads — UNO Cognito (for backend JWT validation) ----------

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_cognito_user_pool_id" {
  name = "${local.uno_ssm_resolved_prefix}/cognito/user-pool-id"
}

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_cognito_alb_client_id" {
  name = "${local.uno_ssm_resolved_prefix}/cognito/alb-client-id"
}

# ---------- SSM Reads — UNO DynamoDB Table Names ----------

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_dynamodb_tables" {
  name = "${local.uno_ssm_resolved_prefix}/dynamodb/tables"
}

# ---------- SSM Reads — UNO Assets Bucket ----------

# checkov:skip=CKV2_AWS_34:UNO-managed SSM parameter — type is not controlled by ARA
data "aws_ssm_parameter" "uno_assets_bucket_name" {
  name = "${local.uno_ssm_resolved_prefix}/s3/assets-bucket-name"
}

locals {
  # Naming prefix: {prefix}-{region_code}-{environment} (same pattern as UNO)
  resource_prefix         = "${var.prefix}-${var.region_code}-${var.environment}"
  permission_boundary_arn = var.permission_boundary_name != null ? "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.permission_boundary_name}" : null

  # S3 bucket naming (same pattern as UNO)
  s3_prefix       = replace(var.prefix, "-", "")
  bucket_suffix   = var.bucket_name_suffix
  ara_bucket_name = var.s3_ara_bucket_name != "" ? var.s3_ara_bucket_name : "${local.s3_prefix}${var.environment}s3assets${local.bucket_suffix}"

  # Resolved SSM prefixes (auto-derived from environment when empty)
  base_ssm_resolved_prefix = var.base_ssm_prefix != "" ? var.base_ssm_prefix : "/haf/useast1/${var.environment}"
  uno_ssm_resolved_prefix  = var.uno_ssm_prefix != "" ? var.uno_ssm_prefix : "/haf-uno/useast1/${var.environment}"

  # Resolve UNO shared resources from SSM (override with tfvars if set)
  alb_listener_arn      = var.alb_listener_arn != "" ? var.alb_listener_arn : (var.enable_alb_integration ? data.aws_ssm_parameter.uno_alb_listener_arn[0].value : "")
  alb_security_group_id = var.alb_security_group_id != "" ? var.alb_security_group_id : (var.enable_alb_integration ? data.aws_ssm_parameter.uno_alb_security_group_id[0].value : "")

  # VPC config (from base infra SSM)
  vpc_id_resolved             = data.aws_ssm_parameter.base_vpc_id.value
  private_subnet_ids_resolved = split(",", data.aws_ssm_parameter.base_private_subnet_ids.value)

  # Cognito for backend JWT (from UNO SSM)
  cognito_user_pool_id_resolved  = data.aws_ssm_parameter.uno_cognito_user_pool_id.value
  cognito_app_client_id_resolved = data.aws_ssm_parameter.uno_cognito_alb_client_id.value

  # Proxy config (from base infra SSM JSON)
  proxy_config    = jsondecode(data.aws_ssm_parameter.base_proxy_config.value)
  http_proxy_url  = lookup(local.proxy_config, "http_proxy", "")
  https_proxy_url = lookup(local.proxy_config, "https_proxy", "")
  no_proxy_value  = "169.254.169.254,169.254.170.2,localhost,127.0.0.1,.s3.amazonaws.com,.transform-custom.us-east-1.api.aws"

  # Base infra KMS key (used by UNO DynamoDB tables)
  base_kms_key_arn = data.aws_ssm_parameter.base_kms_key_arn.value

  # UNO-owned DynamoDB table names (from SSM JSON map)
  uno_dynamodb_tables = jsondecode(data.aws_ssm_parameter.uno_dynamodb_tables.value)

  # UNO assets bucket (from SSM)
  s3_uno_dp_bucket = data.aws_ssm_parameter.uno_assets_bucket_name.value

  # KMS key ARN for DynamoDB encryption (from base infra SSM)
  kms_key_arn = data.aws_ssm_parameter.base_kms_key_arn.value
}

# ---------- S3 Bucket for ARA Assets ----------

resource "aws_s3_bucket" "ara_assets" {
  #checkov:skip=CKV2_AWS_62:Event notifications will be configured when downstream consumers are defined
  #checkov:skip=CKV_AWS_144:Cross-region replication not required for non-critical application assets in single-region deployment
  bucket        = local.ara_bucket_name
  force_destroy = false

  tags = {
    Name = local.ara_bucket_name
  }
}

resource "aws_s3_bucket_versioning" "ara_assets" {
  bucket = aws_s3_bucket.ara_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ara_assets" {
  bucket = aws_s3_bucket.ara_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.cloudwatch_logs.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "ara_assets" {
  bucket = aws_s3_bucket.ara_assets.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_logging" "ara_assets" {
  bucket        = aws_s3_bucket.ara_assets.id
  target_bucket = aws_s3_bucket.ara_assets.id
  target_prefix = "access-logs/"
}

resource "aws_s3_bucket_public_access_block" "ara_assets" {
  bucket = aws_s3_bucket.ara_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------- ARA-owned DynamoDB Tables ----------

resource "aws_dynamodb_table" "atx_assessments" {
  name         = var.dynamodb_tables["atx_assessments"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "application_id"
  range_key    = "repo_run_key"

  attribute {
    name = "application_id"
    type = "S"
  }

  attribute {
    name = "repo_run_key"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = local.base_kms_key_arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.dynamodb_tables["atx_assessments"]}-dynamodb"
  }
}

resource "aws_dynamodb_table" "atx_processing_tasks" {
  name         = var.dynamodb_tables["atx_processing_tasks"]
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "task_id"

  attribute {
    name = "task_id"
    type = "S"
  }

  attribute {
    name = "application_id"
    type = "S"
  }

  global_secondary_index {
    name            = "application_id_index"
    hash_key        = "application_id"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = local.base_kms_key_arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${var.dynamodb_tables["atx_processing_tasks"]}-dynamodb"
  }
}

# ---------- KMS Key for CloudWatch Logs ----------

resource "aws_kms_key" "cloudwatch_logs" {
  description             = "CMK for CloudWatch Logs encryption - ${local.resource_prefix}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootAccountAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt*",
          "kms:Decrypt*",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:Describe*"
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"
          }
        }
      }
    ]
  })

  tags = {
    Name = "${local.resource_prefix}-cloudwatch-logs"
  }
}

resource "aws_kms_alias" "cloudwatch_logs" {
  name          = "alias/${local.resource_prefix}-cloudwatch-logs"
  target_key_id = aws_kms_key.cloudwatch_logs.key_id
}

# ---------- ECS Cluster ----------
resource "aws_ecs_cluster" "main" {
  name = local.resource_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging    = "OVERRIDE"
      kms_key_id = aws_kms_key.cloudwatch_logs.arn
      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.ecs_cluster.name
      }
    }
  }
}

resource "aws_cloudwatch_log_group" "ecs_cluster" {
  name              = "/aws/ecs/${local.resource_prefix}"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.cloudwatch_logs.arn
}

# ---------- EC2 Capacity Provider ----------

resource "aws_iam_role" "ecs_instance" {
  name                 = "${local.resource_prefix}-ecs-instance"
  permissions_boundary = local.permission_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs" {
  name = "${local.resource_prefix}-ecs-instance"
  role = aws_iam_role.ecs_instance.name
}

resource "aws_security_group" "ecs_instances" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required for ECS agent communication with AWS services (ECR, CloudWatch, ECS API)
  name_prefix = "${local.resource_prefix}-ecs-inst-"
  description = "Security group for ECS container instances"
  vpc_id      = local.vpc_id_resolved

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name = "${local.resource_prefix}-ecs-instances"
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_launch_template" "ecs" {
  name_prefix   = "${local.resource_prefix}-ecs-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = var.instance_type

  iam_instance_profile { name = aws_iam_instance_profile.ecs.name }
  vpc_security_group_ids = [aws_security_group.ecs_instances.id]

  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    ecs_cluster_name = aws_ecs_cluster.main.name
    http_proxy       = local.http_proxy_url
    https_proxy      = local.https_proxy_url != "" ? local.https_proxy_url : local.http_proxy_url
    no_proxy         = local.no_proxy_value
  }))

  monitoring { enabled = true }

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.resource_prefix}-ecs-instance"
    }
  }
}

resource "aws_autoscaling_group" "ecs" {
  name                = "${local.resource_prefix}-ecs-asg"
  vpc_zone_identifier = local.private_subnet_ids_resolved
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity

  launch_template {
    id      = aws_launch_template.ecs.id
    version = "$Latest"
  }

  health_check_type         = "EC2"
  health_check_grace_period = 300
  protect_from_scale_in     = true

  tag {
    key                 = "Name"
    value               = "${local.resource_prefix}-ecs-instance"
    propagate_at_launch = true
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [desired_capacity]
  }
}

resource "aws_ecs_capacity_provider" "ec2" {
  name = "${local.resource_prefix}-ec2"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs.arn
    managed_termination_protection = "ENABLED"

    managed_scaling {
      status          = "ENABLED"
      target_capacity = 80
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = [aws_ecs_capacity_provider.ec2.name]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.ec2.name
    weight            = 1
    base              = 1
  }
}

# ---------- ECR Repository ----------

resource "aws_ecr_repository" "backend" {
  #checkov:skip=CKV_AWS_51:Mutable tags required for development workflow using latest tag for iterative deployments
  name                 = "${local.resource_prefix}-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration { scan_on_push = true }

  encryption_configuration {
    encryption_type = "KMS"
  }

  tags = {
    Name = "${local.resource_prefix}-backend"
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ---------- CloudWatch Log Group (backend container) ----------

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.resource_prefix}-backend"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.cloudwatch_logs.arn
}

# ---------- IAM Roles ----------

resource "aws_iam_role" "ecs_execution" {
  name                 = "${local.resource_prefix}-ecs-execution"
  permissions_boundary = local.permission_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.resource_prefix}-execution-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = var.github_token_secret_arn
      },
      {
        Sid    = "KMSForCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = aws_kms_key.cloudwatch_logs.arn
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name                 = "${local.resource_prefix}-ecs-task"
  permissions_boundary = local.permission_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "${local.resource_prefix}-task-policy"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:DescribeTable"
        ]
        Resource = flatten(concat(
          # ARA-owned tables (from var.dynamodb_tables)
          [for table in values(var.dynamodb_tables) : [
            "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${table}",
            "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${table}/index/*"
          ]],
          # UNO-owned tables (from SSM)
          [for key in ["applications", "target_components", "processing_tasks", "app_components", "default_os_versions", "risk_assessments", "wave_patterns", "pod_user_applications"] : [
            "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.uno_dynamodb_tables[key]}",
            "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.uno_dynamodb_tables[key]}/index/*"
          ]]
        ))
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [
          "arn:aws:s3:::${local.ara_bucket_name}",
          "arn:aws:s3:::${local.ara_bucket_name}/*",
          "arn:aws:s3:::${local.s3_uno_dp_bucket}",
          "arn:aws:s3:::${local.s3_uno_dp_bucket}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.*",
          "arn:aws:bedrock:*::foundation-model/amazon.*",
          "arn:aws:bedrock:*::foundation-model/us.amazon.*",
          "arn:aws:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/us.amazon.nova-lite-v1:0",
          "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/us.amazon.nova-lite-v1:0"
        ]
      },
      {
        # Scoped to the actions used to execute transformations, matching the AWS managed
        # policy AWSTransformCustomExecuteTransformations (v4) instead of transform-custom:*.
        # transform-custom does not support resource-level ARNs, so Resource must remain "*".
        #checkov:skip=CKV_AWS_63:transform-custom does not support resource-level permissions; the managed policy also uses "*"
        #checkov:skip=CKV_AWS_286:Service does not support resource-level permissions
        Sid    = "ATXTransformCustom"
        Effect = "Allow"
        Action = [
          "transform-custom:ConverseStream",
          "transform-custom:ExecuteTransformation",
          "transform-custom:GetCampaign",
          "transform-custom:UpdateCampaignRepositoryStatus",
          "transform-custom:UpdateCampaign",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [
          "${aws_cloudwatch_log_group.backend.arn}:*",
          "${aws_cloudwatch_log_group.atx_worker.arn}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:StopTask",
          "ecs:TagResource"
        ]
        Resource = [
          "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.resource_prefix}-atx-worker:*",
          "arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task/${aws_ecs_cluster.main.name}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.ecs_task.arn
        ]
      },
      {
        Sid    = "KMSDecryptForDynamoDB"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = [local.base_kms_key_arn, aws_kms_key.cloudwatch_logs.arn]
      },
      {
        Sid    = "CognitoAccess"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminResetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:ListUsers",
          "cognito-idp:ListGroups"
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/${local.cognito_user_pool_id_resolved}"
      },
      {
        Sid      = "AVPIsAuthorized"
        Effect   = "Allow"
        Action   = ["verifiedpermissions:IsAuthorized", "verifiedpermissions:IsAuthorizedWithToken"]
        Resource = var.enable_avp ? local.avp_policy_store_arn : "arn:aws:verifiedpermissions:${var.aws_region}:${data.aws_caller_identity.current.account_id}:policy-store/*"
      }
    ]
  })
}

# ---------- Security Group (ECS Tasks) ----------

resource "aws_security_group" "ecs_tasks" {
  #checkov:skip=CKV_AWS_382:Unrestricted egress required for AWS service access (DynamoDB, S3, Bedrock, ECR) and GitHub repo cloning
  name_prefix = "${local.resource_prefix}-ecs-task-"
  description = "Security group for ECS tasks"
  vpc_id      = local.vpc_id_resolved

  # Outbound is intentionally unrestricted. ECS tasks require access to multiple
  # AWS services (DynamoDB, S3, Bedrock, CloudWatch Logs, Secrets Manager, ECR,
  # ECS API) and external endpoints (GitHub for repo cloning). These services use
  # dynamic IP ranges that cannot be statically allow-listed. VPC endpoints could
  # partially reduce this, but Bedrock and GitHub still require internet egress.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound - required for AWS service and GitHub access"
  }

  tags = {
    Name = "${local.resource_prefix}-ecs-tasks"
  }

  lifecycle { create_before_destroy = true }
}

# ---------- ECS Task Definition ----------

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.resource_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "${local.resource_prefix}-backend"
    image = "${aws_ecr_repository.backend.repository_url}:latest"

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = concat([
      { name = "PORT", value = tostring(var.container_port) },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "APP_ENV", value = "production" },
      { name = "USE_AWS_PROFILE", value = "false" },
      { name = "LOG_LEVEL", value = "INFO" },
      { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
      { name = "S3_ARA_BUCKET", value = local.ara_bucket_name },
      { name = "S3_UNO_DP_BUCKET", value = local.s3_uno_dp_bucket },
      { name = "COGNITO_USER_POOL_ID", value = local.cognito_user_pool_id_resolved },
      { name = "COGNITO_APP_CLIENT_ID", value = local.cognito_app_client_id_resolved },
      { name = "AUTH_BACKEND", value = var.enable_avp ? "avp" : "cognito" },
      ],
      # AVP env vars — only included when AVP is enabled
      var.enable_avp ? [
        { name = "AVP_POLICY_STORE_ID", value = local.avp_policy_store_id },
      ] : [],
      [
      # UNO-owned tables from SSM
      { name = "APPLICATIONS_TABLE", value = local.uno_dynamodb_tables["applications"] },
      { name = "TARGET_COMPONENTS_TABLE", value = local.uno_dynamodb_tables["target_components"] },
      { name = "PROCESSING_TASKS_TABLE", value = local.uno_dynamodb_tables["processing_tasks"] },
      { name = "APP_COMPONENTS_TABLE", value = local.uno_dynamodb_tables["app_components"] },
      { name = "DEFAULT_OS_VERSION_TABLE", value = local.uno_dynamodb_tables["default_os_versions"] },
      # ARA-owned tables from var
      { name = "ATX_ASSESSMENTS_TABLE", value = var.dynamodb_tables["atx_assessments"] },
      { name = "ATX_PROCESSING_TASKS_TABLE", value = var.dynamodb_tables["atx_processing_tasks"] },
      { name = "RISK_ASSESSMENTS_TABLE", value = local.uno_dynamodb_tables["risk_assessments"] },
      { name = "PATTERNS_TABLE", value = local.uno_dynamodb_tables["wave_patterns"] },
      { name = "POD_ACCESS_TABLE_NAME", value = local.uno_dynamodb_tables["pod_user_applications"] },
      { name = "CORS_ORIGINS", value = var.cors_origins },
      { name = "ECS_CLUSTER", value = aws_ecs_cluster.main.name },
      { name = "ECS_ATX_TASK_DEFINITION", value = "${local.resource_prefix}-atx-worker" },
      { name = "ECS_SUBNETS", value = join(",", local.private_subnet_ids_resolved) },
      { name = "ECS_SECURITY_GROUPS", value = aws_security_group.ecs_tasks.id },
      { name = "ATX_RUN_MODE", value = "ecs" },
      ],
      # Proxy env vars — only included when non-empty
      local.http_proxy_url != "" ? [
        { name = "HTTP_PROXY", value = local.http_proxy_url },
        { name = "http_proxy", value = local.http_proxy_url },
      ] : [],
      local.https_proxy_url != "" ? [
        { name = "HTTPS_PROXY", value = local.https_proxy_url },
        { name = "https_proxy", value = local.https_proxy_url },
      ] : [],
      local.no_proxy_value != "" ? [
        { name = "NO_PROXY", value = local.no_proxy_value },
        { name = "no_proxy", value = local.no_proxy_value },
      ] : [],
      var.container_environment
    )

    secrets = [
      {
        name      = "GITHUB_TOKEN"
        valueFrom = "${var.github_token_secret_arn}:GITHUB_TOKEN::"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.backend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "backend"
      }
    }

    essential = true
  }])
}

# ---------- ALB Integration (optional) ----------

resource "aws_lb_target_group" "backend" {
  #checkov:skip=CKV_AWS_378:Target group uses HTTP for internal ECS-to-ALB communication; TLS is terminated at the ALB listener level
  count = var.enable_alb_integration ? 1 : 0

  name        = "${local.resource_prefix}-backend"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = local.vpc_id_resolved
  target_type = "ip"

  health_check {
    enabled             = true
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  tags = {
    Name = "${local.resource_prefix}-backend"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ALB listener rule — plain forward to ARA backend
resource "aws_lb_listener_rule" "backend" {
  count = var.enable_alb_integration ? 1 : 0

  listener_arn = local.alb_listener_arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend[0].arn
  }

  condition {
    path_pattern {
      values = var.alb_path_patterns
    }
  }
}

# Allow inbound from ALB to ECS tasks
resource "aws_security_group_rule" "alb_to_ecs" {
  count = var.enable_alb_integration && local.alb_security_group_id != "" ? 1 : 0

  type                     = "ingress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  source_security_group_id = local.alb_security_group_id
  security_group_id        = aws_security_group.ecs_tasks.id
  description              = "Allow inbound from ALB"
}

# ---------- ECS Service ----------

resource "aws_ecs_service" "backend" {
  name            = "${local.resource_prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "EC2"

  network_configuration {
    subnets          = local.private_subnet_ids_resolved
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.enable_alb_integration ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.backend[0].arn
      container_name   = "${local.resource_prefix}-backend"
      container_port   = var.container_port
    }
  }

  depends_on = [aws_ecs_cluster_capacity_providers.main]
}

# ---------- ATX Worker (Fargate) Task Definition ----------

resource "aws_cloudwatch_log_group" "atx_worker" {
  name              = "/ecs/${local.resource_prefix}-atx-worker"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.cloudwatch_logs.arn
}

resource "aws_ecs_task_definition" "atx_worker" {
  family                   = "${local.resource_prefix}-atx-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "atx-worker"
    image = "${aws_ecr_repository.backend.repository_url}:latest"

    command = ["python", "-m", "app.workers.atx_worker"]

    environment = concat([
      { name = "AWS_REGION", value = var.aws_region },
      { name = "APP_ENV", value = "production" },
      { name = "USE_AWS_PROFILE", value = "false" },
      { name = "LOG_LEVEL", value = "INFO" },
      { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
      { name = "S3_ARA_BUCKET", value = local.ara_bucket_name },
      { name = "S3_UNO_DP_BUCKET", value = local.s3_uno_dp_bucket },
      { name = "APPLICATIONS_TABLE", value = local.uno_dynamodb_tables["applications"] },
      { name = "ATX_ASSESSMENTS_TABLE", value = var.dynamodb_tables["atx_assessments"] },
      { name = "ATX_PROCESSING_TASKS_TABLE", value = var.dynamodb_tables["atx_processing_tasks"] },
      { name = "ATX_TRANSFORMATION_NAME", value = "AWS/comprehensive-codebase-analysis" },
      { name = "ATX_SHELL_TIMEOUT", value = "3600" },
      { name = "COGNITO_USER_POOL_ID", value = local.cognito_user_pool_id_resolved },
      { name = "COGNITO_APP_CLIENT_ID", value = local.cognito_app_client_id_resolved },
      ],
      local.http_proxy_url != "" ? [
        { name = "HTTP_PROXY", value = local.http_proxy_url },
        { name = "http_proxy", value = local.http_proxy_url },
      ] : [],
      local.https_proxy_url != "" ? [
        { name = "HTTPS_PROXY", value = local.https_proxy_url },
        { name = "https_proxy", value = local.https_proxy_url },
      ] : [],
      local.no_proxy_value != "" ? [
        { name = "NO_PROXY", value = local.no_proxy_value },
        { name = "no_proxy", value = local.no_proxy_value },
      ] : []
    )

    secrets = [
      {
        name      = "GITHUB_TOKEN"
        valueFrom = "${var.github_token_secret_arn}:GITHUB_TOKEN::"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.atx_worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "atx-worker"
      }
    }

    essential = true
  }])
}

# ---------- Amazon Verified Permissions (AVP) — Shared from UNO ----------
# AVP policy store is managed by UNO infra. ARA reads the policy store ID from SSM.

data "aws_ssm_parameter" "uno_avp_policy_store_id" {
  count = var.enable_avp ? 1 : 0
  name  = "${local.uno_ssm_resolved_prefix}/avp/policy-store-id"
}

locals {
  avp_policy_store_id  = var.enable_avp ? data.aws_ssm_parameter.uno_avp_policy_store_id[0].value : ""
  avp_policy_store_arn = var.enable_avp ? "arn:aws:verifiedpermissions:${var.aws_region}:${data.aws_caller_identity.current.account_id}:policy-store/${local.avp_policy_store_id}" : ""
}
