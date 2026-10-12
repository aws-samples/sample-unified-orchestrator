# -----------------------------------------------------------------------------
# Cognito Pre-Authentication Lambda — Entra ID (Azure AD) Federation
# -----------------------------------------------------------------------------
# This Lambda is triggered before Cognito authenticates a user via the
# Entra ID external identity provider. It validates email domains and
# enforces access control policies.
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Lambda Function Package
# -----------------------------------------------------------------------------

data "archive_file" "pre_auth_lambda" {
  count = var.enable_pre_auth_lambda ? 1 : 0

  type        = "zip"
  source_dir  = "${path.module}/lambda/pre_auth"
  output_path = "${path.module}/lambda/pre_auth.zip"
}

# -----------------------------------------------------------------------------
# IAM Role for Pre-Auth Lambda
# -----------------------------------------------------------------------------

resource "aws_iam_role" "pre_auth_lambda" {
  count = var.enable_pre_auth_lambda ? 1 : 0

  name = "${var.project_name}-cognito-pre-auth-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  permissions_boundary = var.permission_boundary_arn

  tags = var.tags
}

# -----------------------------------------------------------------------------
# IAM Policy — CloudWatch Logs
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "pre_auth_lambda_logs" {
  count = var.enable_pre_auth_lambda ? 1 : 0

  name = "${var.project_name}-cognito-pre-auth-logs"
  role = aws_iam_role.pre_auth_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/aws/lambda/${var.project_name}-cognito-pre-auth:*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# IAM Policy — VPC Access (ENI management)
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "pre_auth_lambda_vpc" {
  #checkov:skip=CKV_AWS_355:VPC ENI actions require wildcard resource per AWS documentation
  #checkov:skip=CKV_AWS_290:VPC ENI actions require wildcard resource per AWS documentation
  count = var.enable_pre_auth_lambda && length(var.pre_auth_lambda_subnet_ids) > 0 ? 1 : 0

  name = "${var.project_name}-cognito-pre-auth-vpc"
  role = aws_iam_role.pre_auth_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeNetworkInterfaces"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface"
        ]
        Resource = [
          "arn:aws:ec2:*:*:network-interface/*",
          "arn:aws:ec2:*:*:subnet/*",
          "arn:aws:ec2:*:*:security-group/*"
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group (explicit for retention control)
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "pre_auth_lambda" {
  count = var.enable_pre_auth_lambda ? 1 : 0

  name              = "/aws/lambda/${var.project_name}-cognito-pre-auth"
  retention_in_days = var.pre_auth_log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Lambda Function
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "pre_auth" {
  #checkov:skip=CKV_AWS_272:Code signing not required for this Cognito pre-auth trigger
  #checkov:skip=CKV_AWS_116:DLQ not applicable for synchronous Cognito pre-authentication trigger
  count = var.enable_pre_auth_lambda ? 1 : 0

  function_name = "${var.project_name}-cognito-pre-auth"
  description   = "Cognito Pre-Authentication trigger for Entra ID federation"

  filename         = data.archive_file.pre_auth_lambda[0].output_path
  source_code_hash = data.archive_file.pre_auth_lambda[0].output_base64sha256

  runtime                        = "python3.12"
  handler                        = "index.handler"
  timeout                        = 5
  role                           = aws_iam_role.pre_auth_lambda[0].arn
  reserved_concurrent_executions = var.pre_auth_lambda_reserved_concurrency
  kms_key_arn                    = var.kms_key_arn

  environment {
    variables = {
      LOG_LEVEL             = var.pre_auth_log_level
      ALLOWED_EMAIL_DOMAINS = join(",", var.pre_auth_allowed_email_domains)
    }
  }

  tracing_config {
    mode = "Active"
  }

  vpc_config {
    subnet_ids         = var.pre_auth_lambda_subnet_ids
    security_group_ids = var.pre_auth_lambda_security_group_ids
  }

  depends_on = [
    aws_cloudwatch_log_group.pre_auth_lambda
  ]

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Lambda Permission — Allow Cognito to invoke
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "cognito_pre_auth" {
  count = var.enable_pre_auth_lambda ? 1 : 0

  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_auth[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}

resource "aws_lambda_permission" "cognito_pre_auth_entra" {
  count = var.enable_pre_auth_lambda && var.create_entra_user_pool ? 1 : 0

  statement_id  = "AllowCognitoEntraInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_auth[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.entra[0].arn
}
