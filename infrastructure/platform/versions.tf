# ============================================================================
# UNO Unified Orchestrator - Version Constraints
# ============================================================================

terraform {
  required_version = ">= 1.5.0"

  # Backend configured via -backend-config=../environments/{env}/backend.tfbackend
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}
