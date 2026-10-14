# ============================================================================
# UNO Unified Orchestrator - Provider Configuration
# ============================================================================

provider "aws" {
  region = local.aws_region

  # Apply base tags to ALL resources automatically
  default_tags {
    tags = local.base_tags
  }
}
