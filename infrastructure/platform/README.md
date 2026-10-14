# Platform Infrastructure

Terraform for the shared platform layer. Deploys first and publishes outputs via SSM for downstream consumers.

## Resources

- ALB (HTTPS listener, security group)
- Cognito User Pool + App Client (PKCE auth)
- DynamoDB tables (applications, waves, target_components, etc.)
- ECS Cluster + EC2 Capacity Provider (control plane backend)
- ECR Repository
- CloudFront + S3 (frontend hosting)
- IAM Roles, CloudWatch Logs, SSM Parameters
- Amazon Verified Permissions (AVP) policy store

## Usage

```bash
TF_ENV=nprd mise run platform:tf:init
TF_ENV=nprd mise run platform:tf:plan
TF_ENV=nprd mise run platform:tf:apply
```
