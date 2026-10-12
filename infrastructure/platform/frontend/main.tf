# ============================================================================
# Frontend Component - S3 Buckets (Native aws_s3_* Resources)
# ============================================================================

locals {
  all_tags      = merge(var.tags, var.additional_tags)
  bucket_suffix = var.bucket_name_suffix
}

# ============================================================================
# Frontend Assets Bucket
# ============================================================================

resource "aws_s3_bucket" "frontend" {
  count = var.create_bucket ? 1 : 0

  bucket        = var.bucket_name != "" ? var.bucket_name : null
  force_destroy = var.force_destroy

  tags = merge(local.all_tags, {
    Name = var.bucket_name != "" ? var.bucket_name : "${var.prefix}${var.environment}s3assets${local.bucket_suffix}"
  })
}

data "aws_s3_bucket" "frontend" {
  count = var.create_bucket ? 0 : 1

  bucket = var.bucket_name
}

locals {
  frontend_bucket_id   = var.create_bucket ? aws_s3_bucket.frontend[0].id : data.aws_s3_bucket.frontend[0].id
  frontend_bucket_arn  = var.create_bucket ? aws_s3_bucket.frontend[0].arn : data.aws_s3_bucket.frontend[0].arn
  frontend_bucket_name = var.create_bucket ? aws_s3_bucket.frontend[0].bucket : data.aws_s3_bucket.frontend[0].bucket
}

resource "aws_s3_bucket_versioning" "frontend" {
  count = var.create_bucket ? 1 : 0

  bucket = local.frontend_bucket_id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  count = var.create_bucket ? 1 : 0

  bucket = local.frontend_bucket_id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  count = var.create_bucket ? 1 : 0

  bucket = local.frontend_bucket_id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "frontend_bucket_policy" {
  count = var.create_bucket ? 1 : 0

  statement {
    sid    = "AllowALBAccess"
    effect = "Allow"

    actions = ["s3:GetObject"]

    principals {
      type        = "Service"
      identifiers = ["elasticloadbalancing.amazonaws.com"]
    }

    resources = ["${local.frontend_bucket_arn}/*"]
  }

  statement {
    sid    = "AllowVPCEndpointAccess"
    effect = "Allow"

    actions = ["s3:GetObject"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = ["${local.frontend_bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceVpce"
      values   = [var.vpc_endpoint_id]
    }
  }

  statement {
    sid    = "AllowVPCAccess"
    effect = "Allow"

    actions = ["s3:GetObject"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = ["${local.frontend_bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceVpc"
      values   = [var.vpc_id]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  count = var.create_bucket ? 1 : 0

  bucket = local.frontend_bucket_id
  policy = data.aws_iam_policy_document.frontend_bucket_policy[0].json
}

# ============================================================================
# Logging Bucket (Native aws_s3_* — replaces external S3 module)
# ============================================================================

resource "aws_s3_bucket" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket        = var.logging_bucket_name != "" ? var.logging_bucket_name : "${var.prefix}${var.environment}s3logs${local.bucket_suffix}"
  force_destroy = var.force_destroy

  tags = merge(local.all_tags, {
    Name = var.logging_bucket_name != "" ? var.logging_bucket_name : "${var.prefix}${var.environment}s3logs${local.bucket_suffix}"
  })
}

resource "aws_s3_bucket_versioning" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "logs_bucket_policy" {
  count = var.create_logging_bucket ? 1 : 0

  statement {
    sid    = "AWSLogDeliveryWrite"
    effect = "Allow"

    actions = ["s3:PutObject"]

    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.logs[0].arn}/*"]
  }

  statement {
    sid    = "AWSLogDeliveryAclCheck"
    effect = "Allow"

    actions = ["s3:GetBucketAcl"]

    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }

    resources = [aws_s3_bucket.logs[0].arn]
  }

  statement {
    sid    = "AWSALBLogDelivery"
    effect = "Allow"

    actions = ["s3:PutObject"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.elb_account_id}:root"]
    }

    resources = ["${aws_s3_bucket.logs[0].arn}/*"]
  }

  # NLB access logs use the delivery.logs.amazonaws.com service principal
  statement {
    sid    = "AWSNLBLogDeliveryWrite"
    effect = "Allow"

    actions = ["s3:PutObject"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    resources = ["${aws_s3_bucket.logs[0].arn}/*"]
  }

  statement {
    sid    = "AWSNLBLogDeliveryAclCheck"
    effect = "Allow"

    actions = ["s3:GetBucketAcl"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    resources = [aws_s3_bucket.logs[0].arn]
  }
}

resource "aws_s3_bucket_policy" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id
  policy = data.aws_iam_policy_document.logs_bucket_policy[0].json
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count = var.create_logging_bucket ? 1 : 0

  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "log-expiration"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}
