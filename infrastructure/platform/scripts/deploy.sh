#!/bin/bash
# ============================================================================
# Deploy UNO Unified Orchestrator
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
echo "Deploying UNO Unified Orchestrator to ${ENVIRONMENT}"
echo "============================================================================"

cd "${INFRA_DIR}"

# Initialize Terraform
echo ""
echo "Step 1: Initializing Terraform..."
terraform init -backend-config="../environments/${ENVIRONMENT}/backend.tfbackend" -reconfigure

# Plan deployment
echo ""
echo "Step 2: Planning deployment..."
terraform plan -var-file="../environments/${ENVIRONMENT}/terraform.tfvars" -out=tfplan

# Apply deployment
echo ""
echo "Step 3: Applying deployment..."
terraform apply tfplan

# Clean up plan file
rm -f tfplan

echo ""
echo "============================================================================"
echo "✅ Deployment complete for ${ENVIRONMENT}"
echo "============================================================================"
echo ""
echo "To view outputs:"
echo "  terraform output"
echo ""
echo "To destroy:"
echo "  ./infra/scripts/destroy.sh ${ENVIRONMENT}"
echo "============================================================================"
