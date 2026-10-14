#!/bin/bash
# ============================================================================
# Destroy UNO Unified Orchestrator
# ============================================================================

set -e

ENVIRONMENT=${1:-}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "${SCRIPT_DIR}")"

# Validate environment argument
if [ -z "${ENVIRONMENT}" ]; then
  echo "Usage: $0 <environment>"
  echo "  e.g., $0 dev"
  exit 1
fi

# Validate environment directory exists (environments/ is at repo root, outside infra/)
ENV_DIR="${INFRA_DIR}/../environments/${ENVIRONMENT}"
if [ ! -d "${ENV_DIR}" ]; then
  echo "Error: Environment directory '../environments/${ENVIRONMENT}/' does not exist."
  echo "Available environments:"
  ls -1 "${INFRA_DIR}/../environments/"
  exit 1
fi

echo "============================================================================"
echo "⚠️  WARNING: Destroying UNO Unified Orchestrator in ${ENVIRONMENT}"
echo "============================================================================"
echo ""
echo "This will destroy all UNO infrastructure resources including:"
echo "  - Application Load Balancer and listeners"
echo "  - ECS cluster, services, and task definitions"
echo "  - Cognito User Pool and clients"
echo "  - S3 buckets (frontend assets and logs)"
echo "  - Security groups and IAM roles"
echo "  - SSM parameters"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Destroy cancelled."
    exit 0
fi

cd "${INFRA_DIR}"

# Initialize Terraform
echo "Initializing Terraform..."
terraform init -backend-config="../environments/${ENVIRONMENT}/backend.tfbackend" -reconfigure

# Destroy
echo ""
echo "Destroying resources..."
terraform destroy -var-file="../environments/${ENVIRONMENT}/terraform.tfvars"

echo ""
echo "============================================================================"
echo "✅ Destroy complete for ${ENVIRONMENT}"
echo "============================================================================"
