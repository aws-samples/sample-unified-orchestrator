# Unified Orchestrator - Architecture Documentation

## Overview

The Unified Orchestrator is a cloud-native application migration platform built on AWS, designed to streamline and automate the migration of applications to the HAF (Hybrid Application Framework). The system uses a modern microservices architecture with AI-powered analysis capabilities.

## Architecture Diagram

![Unified Orchestrator Architecture](../architecture.png)

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Privileged  │  │Non-Privileged│  │    Viewer    │         │
│  │    Users     │  │    Users     │  │    Users     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Layer                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React 18 + TypeScript + AWS CloudScape                  │  │
│  │  - Risk Assessment Dashboard                             │  │
│  │  - Wave Pattern Analysis                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Hosted on: S3 + CloudFront CDN                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTPS/REST API
┌─────────────────────────────────────────────────────────────────┐
│                   Application Load Balancer                      │
│  - SSL/TLS Termination                                          │
│  - Path-based routing (/api/*)                                  │
│  - Health checks                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend Layer                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Python FastAPI REST API (ECS on EC2)                      │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │  │
│  │  │   API       │  │  Services   │  │Orchestrators│    │  │
│  │  │  Endpoints  │  │   Layer     │  │   Layer     │    │  │
│  │  │ (wave,pam,  │  │ (pam_svc,  │  │             │    │  │
│  │  │  notes,auth)│  │  notes_svc) │  │             │    │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘    │  │
│  │         │                │                  │           │  │
│  │         └────────────────┴──────────────────┘           │  │
│  │                          │                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │  │
│  │  │Repositories │  │   Models    │  │ Validation  │    │  │
│  │  │   Layer     │  │   Layer     │  │   Layer     │    │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI/ML Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Strands Agent (AWS Bedrock)                             │  │
│  │  - AI Model                                │  │
│  │  - Risk Assessment Tools                                 │  │
│  │  - Pattern Analysis Tools                                │  │
│  │  - Component Analysis                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  DynamoDB    │  │      S3      │  │    Redis     │         │
│  │  (with GSI)  │  │   Storage    │  │   (Cache)    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Security Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Cognito    │  │     IAM      │  │  Security    │         │
│  │    (Auth)    │  │    Roles     │  │   Groups     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Frontend Layer

**Technology Stack:**
- React 18 with TypeScript
- AWS CloudScape Design System
- Vite build tool
- Axios for HTTP requests

**Key Components:**
- Risk Assessment Dashboard
- Wave Pattern Analysis Interface

**Hosting:**
- S3 bucket for static files
- CloudFront CDN for global distribution
- Route 53 for DNS (optional)

**Features:**
- Responsive design
- Real-time updates
- Client-side routing
- Context-based state management

### 2. Backend Layer

**Technology Stack:**
- Python 3.11+ with FastAPI
- Strands SDK for AI integration (ARA only)
- Boto3 for AWS services
- JWT for authentication

**Architecture Pattern:**
- Repository Pattern for data access
- Service Layer for business logic
- Orchestrators for workflow coordination
- API Layer for REST endpoints

**Key Services:**
- Risk Service: AI-powered risk assessment
- Pattern Service: Pattern discovery and analysis
- SCM Service: Source code integration

**Hosting:**
- ECS cluster with EC2 launch type
- Auto-scaling based on CPU/memory
- Private subnets for security
- Application Load Balancer for routing

### 3. AI/ML Layer

**Strands Agent Integration:**
- AWS Bedrock
- Tool-based architecture for specialized analysis
- Parallel processing support
- Error handling and retry logic

**Risk Assessment Tools:**
- Component Analyzer: Analyzes software components
- Team Readiness Assessor: Evaluates team capabilities
- Business Readiness Assessor: Assesses business alignment
- Risk Aggregator: Combines multiple risk factors
- Risk Retriever: Fetches historical data

**Pattern Analysis:**
- TransformationAnalyzer: Discovers patterns
- Similarity Matcher: Groups similar patterns
- Report Generator: Creates HTML/JSON reports

### 4. Data Layer

**DynamoDB Tables:**

| Table | Partition Key | Sort Key | GSI | Purpose |
|-------|--------------|----------|-----|---------|
| applications | application_id | - | wave-index (WAVE) | Application inventory |
| risk_assessments | assessment_id | app_id | app_id-index | Risk assessment metadata |
| app_components | component_id | - | application_id-index | Component inventory |
| target_components | component_id | - | application_name-index, file_key-index | Target versions |
| patterns | pattern_id | - | - | Pattern metadata |
| processing_tasks | task_id | - | - | Task tracking |
| default_os_versions | component_id | application_name | application_name-index, file_key-index | OS defaults |

**S3 Buckets:**
- `unified-orchestrator-assets-{env}-{account}-{region}`: Reports and notes
  - `wave-analysis/{wave_id}/{analysis_id}.{html|json}`: Pattern reports
  - `risk-assessments/{app_id}/`: Risk assessment reports
  - `notes/`: Application notes

**Redis (Optional):**
- Caching layer for frequently accessed data
- Session storage
- Task queue for background jobs

### 5. Security Layer

**Authentication:**
- AWS Cognito User Pools
- JWT token-based authentication
- Token validation on all protected endpoints
- Session management

**Authorization:**
- Role-based access control (RBAC)
- Three user roles: Privileged, Non-Privileged, Viewer
- Auth decorator for endpoint protection
- Fine-grained permissions

**Network Security:**
- VPC with public/private subnets
- Security groups with least privilege
- Private subnets for backend services
- VPC endpoints for AWS services

**Data Security:**
- S3 bucket encryption (AES256)
- DynamoDB encryption at rest
- SSL/TLS for data in transit
- IAM roles with minimal permissions

## Data Flow

### 1. Risk Assessment Flow

```
User → Frontend → POST /api/v1/risk/assess
                     ↓
              Backend API (risk.py)
                     ↓
              Risk Service
                     ↓
              Strands Agent
                     ↓
              AWS Bedrock
                     ↓
              Risk Tools (Component Analyzer, etc.)
                     ↓
              DynamoDB (risk_assessments table)
              S3 (detailed reports)
                     ↓
              Response → Frontend → Dashboard
```

### 2. Pattern Analysis Flow

```
User → Frontend → POST /api/v1/patterns/wave/{wave_id}/analyze
                     ↓
              Backend API (patterns.py)
                     ↓
              Pattern Service
                     ↓
              Pattern Orchestrator
                     ↓
              TransformationAnalyzer
                     ↓
              DynamoDB (query applications by wave using wave-index GSI)
                     ↓
              Pattern Grouping (similarity matching)
                     ↓
              Report Generator (HTML/JSON)
                     ↓
              S3 (wave-analysis/{wave_id}/{analysis_id}.{html|json})
                     ↓
              Response → Frontend → Pattern Analysis UI
```
## Performance Optimizations

### DynamoDB GSI Strategy

**Problem:** Table scans were expensive and slow
**Solution:** Strategic GSI placement on frequently queried attributes

**Optimizations:**
1. **wave-index** on applications: Query applications by wave (100x faster)
2. **app_id-index** on risk_assessments: Query assessments by application (100x faster)
3. **application_id-index** on app_components: Query components by application (100x faster)
4. **application_name-index** on target_components: Query versions by application (50x faster)

**Results:**
- 90-95% reduction in read capacity units (RCU)
- 10-100x faster query performance
- Significant cost savings

### Caching Strategy (Optional)

**Redis Caching:**
- Target components: 1 hour TTL
- Application data: 30 minutes TTL
- Assessment results: 24 hours TTL

**Benefits:**
- Reduced DynamoDB read operations
- Faster response times
- Lower AWS costs

## Scalability

### Horizontal Scaling

**Frontend:**
- CloudFront CDN for global distribution
- S3 for unlimited storage
- No server-side scaling needed

**Backend:**
- ECS Auto Scaling based on CPU/memory
- Application Load Balancer for distribution
- Stateless design for easy scaling

**Database:**
- DynamoDB on-demand billing (auto-scaling)
- S3 for unlimited report storage
- Redis cluster for cache scaling (optional)

### Vertical Scaling

**ECS Tasks:**
- Configurable CPU and memory
- Task definition updates for resource changes
- No downtime during scaling

## High Availability

**Multi-AZ Deployment:**
- ALB across multiple availability zones
- ECS tasks distributed across AZs
- DynamoDB multi-AZ by default
- S3 multi-AZ by default

**Fault Tolerance:**
- Auto Scaling replaces failed instances
- Health checks on ALB and ECS
- DynamoDB automatic failover
- S3 99.999999999% durability

## Monitoring & Logging

**CloudWatch:**
- Application logs from ECS
- ALB access logs
- DynamoDB metrics
- Custom application metrics

**Logging Strategy:**
- Structured JSON logging
- Log levels: DEBUG, INFO, WARNING, ERROR
- Centralized log aggregation
- Log retention policies

## Disaster Recovery

**Backup Strategy:**
- DynamoDB Point-in-Time Recovery (optional)
- S3 versioning enabled
- Regular infrastructure snapshots
- Terraform state backup

**Recovery Procedures:**
- Infrastructure as Code (Terraform)
- Automated deployment scripts
- Database restore procedures
- Documented runbooks

## Security Best Practices

1. **Least Privilege**: IAM roles with minimal permissions
2. **Encryption**: At rest and in transit
3. **Network Isolation**: Private subnets for backend
4. **Secrets Management**: AWS Secrets Manager or Parameter Store
5. **Audit Logging**: CloudTrail for API calls
6. **Security Groups**: Restrictive inbound/outbound rules
7. **Regular Updates**: Dependency updates and security patches

## Cost Optimization

**Strategies:**
1. **DynamoDB**: On-demand billing, GSI optimization
2. **S3**: Lifecycle policies for old reports
3. **ECS**: Right-sized instances, auto-scaling
4. **CloudFront**: Caching for reduced origin requests
5. **Bedrock**: Efficient prompt design, caching

**Estimated Monthly Costs (Production):**
- DynamoDB: $50-100 (with GSI optimization)
- S3: $20-50 (with lifecycle policies)
- ECS: $100-200 (2-4 instances)
- Bedrock: $50-150 (based on usage)
- ALB: $20-30
- CloudFront: $10-30
- **Total**: $250-560/month

## Future Enhancements

1. **Caching Layer**: Redis for improved performance
2. **Message Queue**: SQS for async processing
3. **Monitoring**: Enhanced CloudWatch dashboards
4. **CI/CD**: Automated deployment pipeline
5. **Multi-Region**: Global deployment for HA
6. **API Gateway**: Rate limiting and throttling
7. **Lambda Functions**: Serverless background tasks

## References

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [Strands SDK Documentation](https://github.com/awslabs/strands)
