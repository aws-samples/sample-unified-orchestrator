#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Usage function
usage() {
    echo -e "${GREEN}Usage:${NC}"
    echo -e "  $0                          # Build new image and deploy"
    echo -e "  $0 --skip-build             # Deploy using existing 'latest' tag"
    echo -e "  $0 --use-tag <tag>          # Deploy using specific existing tag"
    echo -e "  $0 --dev-mode               # Deploy with auth bypassed (development)"
    echo -e "  $0 --dev-mode --skip-build  # Combine flags as needed"
    exit 1
}

# Parse arguments
SKIP_BUILD=false
USE_TAG=""
DEV_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            USE_TAG="latest"
            shift
            ;;
        --use-tag)
            SKIP_BUILD=true
            USE_TAG="$2"
            shift 2
            ;;
        --dev-mode)
            DEV_MODE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            usage
            ;;
    esac
done

echo -e "${GREEN}=== ARA ECS Deployment ===${NC}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$TF_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# ─── Prerequisite validation ──────────────────────────────────────────────────
validate_prerequisites() {
    echo -e "${BLUE}Validating prerequisites...${NC}"

    # Check required tools
    for cmd in aws jq python3; do
        if ! command -v $cmd &>/dev/null; then
            echo -e "${RED}Error: Required tool '$cmd' not found. Please install it.${NC}"
            exit 1
        fi
    done

    # Check container runtime available (needed for build)
    if [ "$SKIP_BUILD" = false ]; then
        if ! command -v finch &>/dev/null && ! command -v docker &>/dev/null; then
            echo -e "${RED}Error: Neither Finch nor Docker is installed. Required for image build.${NC}"
            exit 1
        fi
    fi

    # Check AWS identity
    AWS_IDENTITY=$(aws sts get-caller-identity 2>/dev/null) || {
        echo -e "${RED}Error: AWS credentials not configured or expired.${NC}"
        exit 1
    }
    ACCOUNT_ID=$(echo "$AWS_IDENTITY" | jq -r '.Account')
    echo -e "  AWS Account: ${YELLOW}${ACCOUNT_ID}${NC}"
    echo -e "  IAM ARN:     ${YELLOW}$(echo "$AWS_IDENTITY" | jq -r '.Arn')${NC}"

    # Check Terraform outputs exist
    cd "${TF_DIR}"
    if ! terraform output -raw ecr_repository_url &>/dev/null; then
        echo -e "${RED}Error: Terraform outputs not found. Run deploy-infra.sh first.${NC}"
        exit 1
    fi

    echo -e "${GREEN}  Prerequisites OK${NC}\n"
}

validate_prerequisites

# ─── Read Terraform outputs ──────────────────────────────────────────────────
cd "${TF_DIR}"
ECR_URL=$(terraform output -raw ecr_repository_url 2>/dev/null)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name 2>/dev/null)
ECS_SERVICE=$(terraform output -raw ecs_service_name 2>/dev/null)

if [ -z "$ECR_URL" ] || [ -z "$ECS_CLUSTER" ] || [ -z "$ECS_SERVICE" ]; then
    echo -e "${RED}Error: Could not get required values from Terraform outputs${NC}"
    echo -e "${YELLOW}Please run deploy-infra.sh first${NC}"
    exit 1
fi

# Read auth-related Terraform outputs
COGNITO_USER_POOL_ID=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "")
AUTH_MODE=$(terraform output -raw auth_mode 2>/dev/null || echo "cognito")

# Read DynamoDB table names from Terraform outputs
ATX_ASSESSMENTS_TABLE=$(terraform output -raw atx_assessments_table 2>/dev/null || echo "")
ATX_PROCESSING_TASKS_TABLE=$(terraform output -raw atx_processing_tasks_table 2>/dev/null || echo "")
RISK_ASSESSMENTS_TABLE=$(terraform output -raw risk_assessments_table 2>/dev/null || echo "")
APPLICATIONS_TABLE=$(terraform output -raw applications_table 2>/dev/null || echo "")
TARGET_COMPONENTS_TABLE=$(terraform output -raw target_components_table 2>/dev/null || echo "")

# Read S3 bucket names from Terraform outputs
S3_ARA_BUCKET=$(terraform output -raw s3_ara_bucket 2>/dev/null || echo "")
S3_UNO_DP_BUCKET=$(terraform output -raw s3_uno_dp_bucket 2>/dev/null || echo "")

# Extract region from ECR URL
AWS_REGION=$(echo "$ECR_URL" | cut -d'.' -f4)

# ─── Dev mode override ───────────────────────────────────────────────────────
APP_ENV="production"
if [ "$DEV_MODE" = true ]; then
    echo -e "${YELLOW}⚠️  DEV MODE: Auth is bypassed. Do not use in production.${NC}\n"
    APP_ENV="development"
    AUTH_MODE="dev"
fi

echo -e "${GREEN}ECR Repository:          ${YELLOW}$ECR_URL${NC}"
echo -e "${GREEN}ECS Cluster:             ${YELLOW}$ECS_CLUSTER${NC}"
echo -e "${GREEN}ECS Service:             ${YELLOW}$ECS_SERVICE${NC}"
echo -e "${GREEN}AWS Region:              ${YELLOW}$AWS_REGION${NC}"
echo -e "${GREEN}Auth Mode:               ${YELLOW}$AUTH_MODE${NC}"
echo -e "${GREEN}APP_ENV:                 ${YELLOW}$APP_ENV${NC}"
if [ -n "$COGNITO_USER_POOL_ID" ]; then
    echo -e "${GREEN}Cognito Pool:            ${YELLOW}$COGNITO_USER_POOL_ID${NC}"
fi
echo -e "${GREEN}ATX Assessments Table:   ${YELLOW}$ATX_ASSESSMENTS_TABLE${NC}"
echo -e "${GREEN}ATX Processing Table:    ${YELLOW}$ATX_PROCESSING_TASKS_TABLE${NC}"
echo -e "${GREEN}Risk Assessments Table:  ${YELLOW}$RISK_ASSESSMENTS_TABLE${NC}"
echo -e "${GREEN}Applications Table:      ${YELLOW}$APPLICATIONS_TABLE${NC}"
echo -e "${GREEN}Target Components Table: ${YELLOW}$TARGET_COMPONENTS_TABLE${NC}"
echo -e "${GREEN}S3 ARA Bucket:           ${YELLOW}$S3_ARA_BUCKET${NC}"
echo -e "${GREEN}S3 UNO DP Bucket:        ${YELLOW}$S3_UNO_DP_BUCKET${NC}"
echo ""

VERSION_TAG=$(date +%Y%m%d-%H%M%S)

if [ "$SKIP_BUILD" = true ]; then
    echo -e "${YELLOW}Skipping build - using existing image tag: $USE_TAG${NC}\n"
    IMAGE_TO_DEPLOY="$ECR_URL:$USE_TAG"
else
    echo -e "${GREEN}Version Tag: ${YELLOW}$VERSION_TAG${NC}\n"
    IMAGE_TO_DEPLOY="$ECR_URL:$VERSION_TAG"

    # Detect container runtime
    if command -v finch &> /dev/null; then
        CONTAINER_CLI="finch"
    elif command -v docker &> /dev/null; then
        CONTAINER_CLI="docker"
    else
        echo -e "${RED}Error: Neither Finch nor Docker is installed${NC}"
        exit 1
    fi

    echo -e "${GREEN}Using $CONTAINER_CLI as container runtime${NC}"

    if ! $CONTAINER_CLI info > /dev/null 2>&1; then
        if [ "$CONTAINER_CLI" = "finch" ]; then
            echo -e "${YELLOW}Starting Finch VM...${NC}"
            finch vm start
            sleep 5
        else
            echo -e "${RED}Error: $CONTAINER_CLI is not running${NC}"
            exit 1
        fi
    fi

    # Login to ECR
    echo -e "\n${GREEN}Logging in to ECR...${NC}"
    aws ecr get-login-password --region "$AWS_REGION" | $CONTAINER_CLI login --username AWS --password-stdin "$ECR_URL"

    # Build Docker image
    echo -e "\n${GREEN}Building Docker image...${NC}"
    cd "$BACKEND_DIR"
    $CONTAINER_CLI build --platform linux/amd64 -t "$ECR_URL":"$VERSION_TAG" -t "$ECR_URL":latest .

    # Push images
    echo -e "\n${GREEN}Pushing images to ECR...${NC}"
    $CONTAINER_CLI push "$ECR_URL":"$VERSION_TAG"
    $CONTAINER_CLI push "$ECR_URL":latest
fi

# ─── Update ECS task definition with auth, table, and S3 env vars ────────────
echo -e "\n${GREEN}Updating ECS task definition and service...${NC}"

CURRENT_TASK_DEF=$(aws ecs describe-task-definition \
    --task-definition "$(aws ecs describe-services \
        --cluster "$ECS_CLUSTER" \
        --services "$ECS_SERVICE" \
        --region "$AWS_REGION" \
        --query 'services[0].taskDefinition' \
        --output text | sed 's/:[0-9]*$//')" \
    --region "$AWS_REGION" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo -e "${GREEN}Latest Task Definition Revision: ${YELLOW}$CURRENT_TASK_DEF${NC}"

# Fetch current task definition JSON
aws ecs describe-task-definition \
    --task-definition "$CURRENT_TASK_DEF" \
    --region "$AWS_REGION" \
    --query 'taskDefinition' > /tmp/ara-current-task-def.json

# Use Python script to update image and inject all env vars into the task definition
python3 "${SCRIPT_DIR}/update_task_def.py" \
    --input /tmp/ara-current-task-def.json \
    --output /tmp/ara-new-task-def.json \
    --image "$IMAGE_TO_DEPLOY" \
    --cognito-pool-id "$COGNITO_USER_POOL_ID" \
    --region "$AWS_REGION" \
    --app-env "$APP_ENV" \
    --atx-assessments-table "$ATX_ASSESSMENTS_TABLE" \
    --atx-processing-tasks-table "$ATX_PROCESSING_TASKS_TABLE" \
    --risk-assessments-table "$RISK_ASSESSMENTS_TABLE" \
    --applications-table "$APPLICATIONS_TABLE" \
    --target-components-table "$TARGET_COMPONENTS_TABLE" \
    --s3-ara-bucket "$S3_ARA_BUCKET" \
    --s3-uno-dp-bucket "$S3_UNO_DP_BUCKET"

echo -e "${GREEN}Auth env vars injected: COGNITO_USER_POOL_ID, COGNITO_REGION, APP_ENV=${YELLOW}$APP_ENV${NC}"
echo -e "${GREEN}Table env vars injected: ATX_ASSESSMENTS_TABLE, ATX_PROCESSING_TASKS_TABLE, RISK_ASSESSMENTS_TABLE, APPLICATIONS_TABLE, TARGET_COMPONENTS_TABLE${NC}"
echo -e "${GREEN}S3 env vars injected: S3_ARA_BUCKET, S3_UNO_DP_BUCKET${NC}"
if [ "$APP_ENV" = "development" ]; then
    echo -e "${GREEN}Dev env var injected: DEV_PERSONA=${YELLOW}privileged${NC}"
fi

NEW_TASK_ARN=$(aws ecs register-task-definition \
    --cli-input-json file:///tmp/ara-new-task-def.json \
    --region "$AWS_REGION" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

echo -e "${GREEN}New Task Definition: ${YELLOW}$NEW_TASK_ARN${NC}"

aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$NEW_TASK_ARN" \
    --force-new-deployment \
    --region "$AWS_REGION" > /dev/null

rm -f /tmp/ara-current-task-def.json /tmp/ara-new-task-def.json

# ─── Verification output ────────────────────────────────────────────────────
echo -e "\n${GREEN}=== Deployment Initiated ===${NC}"
echo -e "Image:   ${YELLOW}$IMAGE_TO_DEPLOY${NC}"
echo -e "Cluster: ${YELLOW}$ECS_CLUSTER${NC}"
echo -e "Service: ${YELLOW}$ECS_SERVICE${NC}"
echo -e "APP_ENV: ${YELLOW}$APP_ENV${NC}"
echo ""

echo -e "${BLUE}=== Verify Deployment ===${NC}"
echo -e "Health:  ${YELLOW}curl -s https://<alb-domain>/api/v1/ara/health${NC}"
echo -e "ECS:     ${YELLOW}aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION --query 'services[0].deployments'${NC}"
echo -e "Task:    ${YELLOW}aws ecs describe-task-definition --task-definition $NEW_TASK_ARN --region $AWS_REGION --query 'taskDefinition.containerDefinitions[0].environment'${NC}"
echo ""

# ─── Manual test notes ───────────────────────────────────────────────────────
# TEST: task definition registered with all env vars
#   Run: ./deploy-ecs.sh --skip-build
#   Verify: aws ecs describe-task-definition --task-definition <new-arn> \
#           --query 'taskDefinition.containerDefinitions[0].environment'
#   Expected env vars present:
#     - COGNITO_USER_POOL_ID = <pool-id from terraform>
#     - COGNITO_REGION = <region>
#     - APP_ENV = production
#     - ATX_ASSESSMENTS_TABLE = <table_prefix>-atx-assessments
#     - ATX_PROCESSING_TASKS_TABLE = <table_prefix>-atx-processing-tasks
#     - RISK_ASSESSMENTS_TABLE = <table_prefix>-risk-assessments
#     - APPLICATIONS_TABLE = <data_plane_prefix>-applications
#     - TARGET_COMPONENTS_TABLE = <data_plane_prefix>-target-components
#     - S3_ARA_BUCKET = <s3_ara_bucket_name>
#     - S3_UNO_DP_BUCKET = <s3_uno_dp_bucket_name>
#     - DEV_PERSONA should NOT be present
#
# TEST: task definition with --dev-mode has development env vars
#   Run: ./deploy-ecs.sh --dev-mode --skip-build
#   Verify: aws ecs describe-task-definition --task-definition <new-arn> \
#           --query 'taskDefinition.containerDefinitions[0].environment'
#   Expected env vars present:
#     - APP_ENV = development
#     - DEV_PERSONA = privileged
#     - COGNITO_USER_POOL_ID = <pool-id from terraform>
#     - COGNITO_REGION = <region>
#     - All table and S3 env vars as above
