# ============================================================================
# Backend Component - Main Infrastructure
# Replaces external ecs_ec2 module with native aws_* resources
# ============================================================================

locals {
  all_tags = merge(var.tags, var.additional_tags)

  # Permission boundary ARN (null when not provided)
  permission_boundary_arn = var.permission_boundary_name != null ? "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.permission_boundary_name}" : null
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

# ============================================================================
# DYNAMODB TABLES
# ============================================================================

# Table definitions keyed by the dynamodb_tables map keys
# Each table uses PAY_PER_REQUEST billing and SSE encryption

locals {
  # Table schema definitions — hash_key, range_key (optional), GSIs
  table_schemas = {
    risk_assessments = {
      hash_key  = "assessment_id"
      range_key = "app_id"
      attributes = [
        { name = "assessment_id", type = "S" },
        { name = "app_id", type = "S" }
      ]
      gsis = [
        { name = "app_id_index", hash_key = "app_id" }
      ]
    }
    applications = {
      hash_key  = "application_id"
      range_key = null
      attributes = [
        { name = "application_id", type = "S" },
        { name = "WAVE", type = "S" }
      ]
      gsis = [
        { name = "wave_index", hash_key = "WAVE" }
      ]
    }
    wave_patterns = {
      hash_key  = "pattern_id"
      range_key = null
      attributes = [
        { name = "pattern_id", type = "S" },
        { name = "wave_id", type = "S" }
      ]
      gsis = [
        { name = "wave_id_index", hash_key = "wave_id" }
      ]
    }
    target_components = {
      hash_key  = "component_id"
      range_key = null
      attributes = [
        { name = "component_id", type = "S" },
        { name = "application_name", type = "S" },
        { name = "file_key", type = "S" }
      ]
      gsis = [
        { name = "application_name_index", hash_key = "application_name" },
        { name = "file_key_index", hash_key = "file_key" }
      ]
    }
    processing_tasks = {
      hash_key  = "task_id"
      range_key = null
      attributes = [
        { name = "task_id", type = "S" }
      ]
      gsis = []
    }
    app_components = {
      hash_key  = "component_id"
      range_key = null
      attributes = [
        { name = "component_id", type = "S" },
        { name = "application_id", type = "S" }
      ]
      gsis = [
        { name = "application_id_index", hash_key = "application_id" }
      ]
    }
    app_noise_components = {
      hash_key  = "component_id"
      range_key = null
      attributes = [
        { name = "component_id", type = "S" },
        { name = "application_id", type = "S" }
      ]
      gsis = [
        { name = "application_id_index", hash_key = "application_id" }
      ]
    }
    default_os_versions = {
      hash_key  = "component_id"
      range_key = "application_name"
      attributes = [
        { name = "component_id", type = "S" },
        { name = "application_name", type = "S" },
        { name = "file_key", type = "S" }
      ]
      gsis = [
        { name = "application_name_index", hash_key = "application_name" },
        { name = "file_key_index", hash_key = "file_key" }
      ]
    }
    pod_user_applications = {
      hash_key  = "pod_id"
      range_key = null
      attributes = [
        { name = "pod_id", type = "S" },
        { name = "email", type = "S" }
      ]
      gsis = [
        { name = "email-index", hash_key = "email" }
      ]
    }
  }

  # Only create tables that are in the dynamodb_tables map
  tables_to_create = {
    for key, full_name in var.dynamodb_tables :
    key => merge(local.table_schemas[key], { full_name = full_name })
    if contains(keys(local.table_schemas), key)
  }
}

resource "aws_dynamodb_table" "tables" {
  for_each = local.tables_to_create

  name         = each.value.full_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value.hash_key
  range_key    = each.value.range_key

  dynamic "attribute" {
    for_each = each.value.attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  dynamic "global_secondary_index" {
    for_each = each.value.gsis
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      projection_type = "ALL"
    }
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery {
    enabled = var.enable_dynamodb_pitr
  }

  tags = merge(local.all_tags, {
    Name = "${each.value.full_name}-dynamodb"
  })
}

# ============================================================================
# ECR REPOSITORY
# ============================================================================

#checkov:skip=CKV_AWS_51:ECR uses immutable tags with commit-SHA based tagging
resource "aws_ecr_repository" "backend" {
  name                 = "${var.naming_prefix}-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-backend"
  })
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

# ============================================================================
# ECS CLUSTER
# ============================================================================

resource "aws_ecs_cluster" "this" {
  name = "${var.naming_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-cluster"
  })
}

# ============================================================================
# ECS-OPTIMIZED AMI LOOKUP
# ============================================================================

# checkov:skip=CKV2_AWS_34:AWS-managed public SSM parameter (/aws/service/ecs/optimized-ami) — type is String by design, not user-controlled
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

# ============================================================================
# EC2 LAUNCH TEMPLATE
# ============================================================================

resource "aws_launch_template" "ecs" {
  name_prefix            = "${var.naming_prefix}-ecs-"
  image_id               = data.aws_ssm_parameter.ecs_ami.value
  instance_type          = var.instance_type
  update_default_version = true

  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    ecs_cluster_name = aws_ecs_cluster.this.name
    http_proxy       = var.http_proxy
    https_proxy      = var.https_proxy
    no_proxy         = var.no_proxy
  }))

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.ecs_instances.id]
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = var.volume_size
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  # Enforce IMDSv2 — hop limit 2 required for ECS agent running in containers
  # checkov:skip=CKV_AWS_341:Hop limit 2 is required for ECS on EC2 — containers need an extra hop to reach IMDS
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(local.all_tags, {
      Name = "${var.naming_prefix}-ecs-instance"
    })
  }

  tag_specifications {
    resource_type = "volume"
    tags = merge(local.all_tags, {
      Name = "${var.naming_prefix}-ecs-volume"
    })
  }

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-launch-template"
  })
}

# ============================================================================
# AUTO SCALING GROUP
# ============================================================================

resource "aws_autoscaling_group" "ecs" {
  name_prefix         = "${var.naming_prefix}-ecs-"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity

  # Scale-in protection for ECS managed draining
  protect_from_scale_in = true

  launch_template {
    id      = aws_launch_template.ecs.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${var.naming_prefix}-ecs-instance"
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

# ============================================================================
# ECS CAPACITY PROVIDER
# ============================================================================

resource "aws_ecs_capacity_provider" "this" {
  name = "${var.naming_prefix}-cp"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs.arn
    managed_termination_protection = "ENABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 80
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 1000
      instance_warmup_period    = 300
    }
  }

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-cp"
  })
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = [aws_ecs_capacity_provider.this.name]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.this.name
    base              = 1
    weight            = 100
  }
}


# ============================================================================
# IAM - EC2 INSTANCE ROLE (ECS Agent + SSM)
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

resource "aws_iam_role" "ecs_instance" {
  name                 = "${var.naming_prefix}-ecs-instance-role"
  assume_role_policy   = data.aws_iam_policy_document.ec2_assume_role.json
  permissions_boundary = local.permission_boundary_arn

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-instance-role"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ecs" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ssm" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ecs_instance" {
  name = "${var.naming_prefix}-ecs-instance-profile"
  role = aws_iam_role.ecs_instance.name

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-instance-profile"
  })
}

# ============================================================================
# IAM - ECS TASK EXECUTION ROLE
# ============================================================================

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name                 = "${var.naming_prefix}-ecs-task-execution-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  permissions_boundary = local.permission_boundary_arn

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-task-execution-role"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Optional: Private registry credentials access (e.g., JFrog)
resource "aws_iam_role_policy" "ecs_task_execution_registry_secret" {
  count = var.registry_credentials_secret_arn != "" ? 1 : 0

  name = "${var.naming_prefix}-ecs-exec-registry-secret"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = var.registry_credentials_secret_arn
      }
    ]
  })
}


# ============================================================================
# IAM - ECS TASK ROLE
# ============================================================================

resource "aws_iam_role" "ecs_task" {
  name                 = "${var.naming_prefix}-ecs-task-role"
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  permissions_boundary = local.permission_boundary_arn

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-task-role"
  })
}

resource "aws_iam_policy" "ecs_task_permissions" {
  name        = "${var.naming_prefix}-ecs-task-permissions"
  description = "ECS task permissions for DynamoDB, S3, Bedrock, and Cognito"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem"
        ]
        Resource = flatten([
          for key, table in aws_dynamodb_table.tables : [
            table.arn,
            "${table.arn}/*"
          ]
        ])
      },
      {
        Sid    = "S3Access"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = concat(
          var.assets_bucket_name != "" ? [
            "arn:aws:s3:::${var.assets_bucket_name}",
            "arn:aws:s3:::${var.assets_bucket_name}/*"
          ] : [],
          [
            "arn:aws:s3:::${var.naming_prefix}-*",
            "arn:aws:s3:::${var.naming_prefix}-*/*",
            "arn:aws:s3:::hafuno*",
            "arn:aws:s3:::hafuno*/*"
          ]
        )
      },
      {
        Sid    = "BedrockAccess"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:0",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-pro-v1:0",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
        ]
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
        Resource = var.cognito_user_pool_id != "" ? [
          "arn:aws:cognito-idp:${var.cognito_region}:${data.aws_caller_identity.current.account_id}:userpool/${var.cognito_user_pool_id}"
        ] : []
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
          "kms:DescribeKey"
        ]
        Resource = var.kms_key_arn != "" ? [var.kms_key_arn] : []
      },
      {
        Sid    = "AVPIsAuthorized"
        Effect = "Allow"
        Action = [
          "verifiedpermissions:IsAuthorized",
          "verifiedpermissions:IsAuthorizedWithToken"
        ]
        Resource = var.avp_policy_store_arn != "" ? [var.avp_policy_store_arn] : [
          "arn:aws:verifiedpermissions:${var.aws_region}:${data.aws_caller_identity.current.account_id}:policy-store/*"
        ]
      }
    ]
  })

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-task-permissions"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_permissions" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_task_permissions.arn
}


# ============================================================================
# SECURITY GROUPS
# ============================================================================

# ECS Task Security Group — inbound from ALB on container port
resource "aws_security_group" "ecs_tasks" {
  name        = "${var.naming_prefix}-ecs-sg"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "ecs_tasks_from_alb" {
  security_group_id            = aws_security_group.ecs_tasks.id
  referenced_security_group_id = var.alb_security_group_id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
  description                  = "Allow traffic from ALB on container port"
}

resource "aws_vpc_security_group_egress_rule" "ecs_tasks_all" {
  security_group_id = aws_security_group.ecs_tasks.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow all outbound traffic"
}

# EC2 Instance Security Group — inbound from VPC CIDR
resource "aws_security_group" "ecs_instances" {
  name        = "${var.naming_prefix}-ecs-instances-sg"
  description = "Security group for ECS EC2 instances"
  vpc_id      = var.vpc_id

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-ecs-instances-sg"
  })
}

resource "aws_vpc_security_group_ingress_rule" "ecs_instances_from_vpc" {
  security_group_id = aws_security_group.ecs_instances.id
  from_port         = 0
  to_port           = 65535
  ip_protocol       = "tcp"
  cidr_ipv4         = data.aws_vpc.selected.cidr_block
  description       = "Allow all TCP traffic from VPC CIDR"
}

resource "aws_vpc_security_group_egress_rule" "ecs_instances_all" {
  security_group_id = aws_security_group.ecs_instances.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Allow all outbound traffic"
}

# ============================================================================
# CLOUDWATCH LOG GROUP
# ============================================================================

resource "aws_cloudwatch_log_group" "ecs_backend" {
  name              = "/aws/ecs/${var.naming_prefix}/backend"
  retention_in_days = var.ecs_log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(local.all_tags, {
    Name = "/aws/ecs/${var.naming_prefix}/backend"
  })
}

# ============================================================================
# ECS TASK DEFINITION
# ============================================================================

locals {
  # Mapping from dynamodb_tables keys to the env var names the application expects
  dynamodb_env_var_names = {
    applications           = "APPLICATIONS_TABLE"
    risk_assessments       = "DYNAMODB_RISK_ASSESSMENTS_TABLE"
    wave_patterns          = "DYNAMODB_WAVE_PATTERNS_TABLE"
    processing_tasks       = "DYNAMODB_PROCESSING_TASKS_TABLE"
    target_components      = "DYNAMODB_TARGET_COMPONENTS_TABLE"
    app_components         = "DYNAMODB_APP_COMPONENTS_TABLE"
    app_noise_components   = "DYNAMODB_APP_NOISE_COMPONENTS_TABLE"
    default_os_versions    = "DYNAMODB_DEFAULT_OS_VERSIONS_TABLE"
    pod_user_applications  = "POD_ACCESS_TABLE_NAME"
  }

  required_container_environment = concat(
    [
      {
        name  = "AWS_REGION"
        value = var.aws_region
      },
      {
        name  = "APP_ENV"
        value = "production"
      },
      {
        name  = "PRIVILEGED_GROUP_NAME"
        value = "privileged"
      },
      {
        name  = "USE_AWS_PROFILE"
        value = "false"
      }
    ],
    # Auto-derived DynamoDB table names from Terraform-managed resources
    [
      for key, full_name in var.dynamodb_tables : {
        name  = lookup(local.dynamodb_env_var_names, key, "DYNAMODB_${upper(key)}_TABLE")
        value = full_name
      }
    ],
    # Auto-derived S3 assets bucket name
    var.assets_bucket_name != "" ? [
      {
        name  = "S3_UNO_DP_BUCKET"
        value = var.assets_bucket_name
      }
    ] : [],
    var.cors_origins != "" ? [
      {
        name  = "CORS_ORIGINS"
        value = var.cors_origins
      }
    ] : [],
    var.cognito_user_pool_id != "" ? [
      {
        name  = "COGNITO_USER_POOL_ID"
        value = var.cognito_user_pool_id
      }
    ] : [],
    var.cognito_region != "" ? [
      {
        name  = "COGNITO_REGION"
        value = var.cognito_region
      }
    ] : [],
    # AVP configuration
    var.enable_avp ? [
      {
        name  = "AUTH_BACKEND"
        value = "avp"
      },
      {
        name  = "AVP_POLICY_STORE_ID"
        value = var.avp_policy_store_id
      }
    ] : [],
    var.http_proxy != "" ? [
      {
        name  = "HTTP_PROXY"
        value = var.http_proxy
      },
      {
        name  = "HTTPS_PROXY"
        value = var.https_proxy != "" ? var.https_proxy : var.http_proxy
      },
      {
        name  = "http_proxy"
        value = var.http_proxy
      },
      {
        name  = "https_proxy"
        value = var.https_proxy != "" ? var.https_proxy : var.http_proxy
      },
      {
        name  = "NO_PROXY"
        value = "169.254.169.254,169.254.170.2,localhost,127.0.0.1,.s3.amazonaws.com,.transform-custom.us-east-1.api.aws"
      },
      {
        name  = "no_proxy"
        value = "169.254.169.254,169.254.170.2,localhost,127.0.0.1,.s3.amazonaws.com,.transform-custom.us-east-1.api.aws"
      }
    ] : []
  )

  container_environment_merged = [
    for name, evs in {
      for ev in concat(local.required_container_environment, var.container_environment) :
      ev.name => ev...
    } : evs[length(evs) - 1]
  ]
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.naming_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    merge(
      {
        name      = "backend"
        image     = var.container_image != "" ? var.container_image : "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
        essential = true

        portMappings = [{
          containerPort = var.container_port
          protocol      = "tcp"
        }]

        logConfiguration = {
          logDriver = "awslogs"
          options = {
            "awslogs-group"         = aws_cloudwatch_log_group.ecs_backend.name
            "awslogs-region"        = var.aws_region
            "awslogs-stream-prefix" = "backend"
          }
        }

        environment = local.container_environment_merged
      },
      var.registry_credentials_secret_arn != "" ? {
        repositoryCredentials = {
          credentialsParameter = var.registry_credentials_secret_arn
        }
      } : {}
    )
  ])

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-backend-task-def"
  })
}

# ============================================================================
# ECS SERVICE
# ============================================================================

resource "aws_ecs_service" "backend" {
  name            = "${var.naming_prefix}-backend"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "EC2"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn != "" ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = "backend"
      container_port   = var.container_port
    }
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.this
  ]

  tags = merge(local.all_tags, {
    Name = "${var.naming_prefix}-backend-service"
  })
}
