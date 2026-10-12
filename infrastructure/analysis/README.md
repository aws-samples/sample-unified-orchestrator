# Analysis Infrastructure

Terraform for the analysis engine. Reads SSM parameters published by the platform infrastructure.

## Resources

- ECS Cluster + EC2 Capacity Provider
- ECS Task Definitions (backend + ATX worker on Fargate)
- ECR Repository
- DynamoDB tables (atx_assessments, atx_processing_tasks)
- S3 Bucket (ATX results, risk reports)
- ALB Target Group + Listener Rule
- IAM Roles, CloudWatch Logs, KMS Key

## Usage

```bash
TF_ENV=nprd mise run analysis:tf:init
TF_ENV=nprd mise run analysis:tf:plan
TF_ENV=nprd mise run analysis:tf:apply
```

## Dependencies

Reads SSM parameters from platform infrastructure:
- ALB listener ARN, Cognito user pool, DynamoDB table names, VPC/subnet IDs
