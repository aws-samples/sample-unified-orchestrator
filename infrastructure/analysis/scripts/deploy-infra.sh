#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== ARA Infrastructure Deployment ===${NC}\n"

# Change to terraform directory
cd "$(dirname "$0")/.."

# Check if terraform.tfvars exists
if [ ! -f "terraform.tfvars" ]; then
    echo -e "${RED}Error: terraform.tfvars not found${NC}"
    echo -e "${YELLOW}Please configure terraform.tfvars first${NC}"
    exit 1
fi

# Initialize Terraform
echo -e "${GREEN}Step 1: Initializing Terraform...${NC}"
terraform init

# Validate configuration
echo -e "\n${GREEN}Step 2: Validating configuration...${NC}"
terraform validate

# Plan
echo -e "\n${GREEN}Step 3: Creating execution plan...${NC}"
terraform plan -out=tfplan

# Ask for confirmation
echo -e "\n${YELLOW}Do you want to apply this plan? (yes/no)${NC}"
read -r response

if [ "$response" = "yes" ]; then
    echo -e "\n${GREEN}Step 4: Applying configuration...${NC}"
    terraform apply tfplan
    rm -f tfplan

    echo -e "\n${GREEN}=== Deployment Complete ===${NC}\n"

    # Display outputs
    echo -e "${GREEN}Important Outputs:${NC}"
    echo -e "ECR Repository: ${YELLOW}$(terraform output -raw ecr_repository_url)${NC}"
    echo -e "ECS Cluster:    ${YELLOW}$(terraform output -raw ecs_cluster_name)${NC}"
    echo -e "ECS Service:    ${YELLOW}$(terraform output -raw ecs_service_name)${NC}"
    echo -e "Log Group:      ${YELLOW}$(terraform output -raw log_group_name)${NC}"

    echo -e "\n${GREEN}Next Step:${NC}"
    echo "  ./deploy-ecs.sh"
else
    echo -e "${YELLOW}Deployment cancelled${NC}"
    rm -f tfplan
    exit 0
fi
