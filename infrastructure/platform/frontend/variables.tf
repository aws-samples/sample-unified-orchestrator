# ============================================================================
# Frontend Component - Variables
# ============================================================================

variable "environment" {
  description = "Environment name (e.g., dev, prod)"
  type        = string
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "prefix" {
  description = "Short prefix for S3 bucket naming (e.g., 'hafuno') — no dashes, AT&T S3 pattern"
  type        = string
}

variable "aws_region" {
  description = "AWS region (e.g., us-east-1)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for S3 bucket module policies"
  type        = string
}

variable "bucket_name" {
  description = "Custom S3 bucket name for frontend hosting (AT&T pattern: prefixenvironments3assets01)"
  type        = string
  default     = ""
}

variable "create_bucket" {
  description = "Create S3 bucket (set to false if bucket already exists)"
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Allow bucket to be destroyed even if it contains objects"
  type        = bool
  default     = false
}

variable "vpc_endpoint_id" {
  description = "VPC endpoint ID for S3 bucket policy access"
  type        = string
}

variable "create_logging_bucket" {
  description = "Create a separate bucket for ALB access logs"
  type        = bool
  default     = true
}

variable "logging_bucket_name" {
  description = "Custom S3 bucket name for logs (AT&T pattern: prefixenvironments3logs01)"
  type        = string
  default     = ""
}

variable "elb_account_id" {
  description = "AWS ELB service account ID for the region (us-east-1: 127311923021)"
  type        = string
}

variable "tags" {
  description = "Base tags applied to all resources"
  type        = map(string)
  default     = {}
}

variable "additional_tags" {
  description = "Additional component-specific tags (e.g., Component = Frontend)"
  type        = map(string)
  default     = {}
}

variable "bucket_name_suffix" {
  description = "Suffix appended to S3 bucket names for uniqueness (e.g., account ID or random string)"
  type        = string
  default     = ""
}
