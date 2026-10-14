# Unified Orchestrator Platform

> **⚠️ This project is sample/educational code and is NOT intended for production use
> without additional security hardening. See [SECURITY.md](SECURITY.md) for production considerations.**

Monorepo for the application replatforming platform — a control plane for managing application portfolios, wave planning,  and an analysis engine for risk assessment, pattern discovery, and automated code transformation.

## Repository Structure

```
├── services/
│   ├── control-plane/        # FastAPI — application management, wave planning, user access
│   └── analysis-engine/      # FastAPI — risk assessment, pattern analysis, code transformation
│
├── frontend/                 # React/Vite — unified UI for all platform features
│
├── infrastructure/
│   ├── platform/             # Terraform — ALB, Cognito, DynamoDB, CloudFront, SSM
│   ├── analysis/             # Terraform — ECS, ECR, S3, DynamoDB (analysis-specific)
│   └── environments/         # Per-environment tfvars and backend configs
│       ├── dev/
│       ├── nprd/
│       ├── trn/
│       └── prod/
│
├── scripts/                  # Setup, start, and utility scripts
├── docs/                     # Architecture and API documentation
├── .gitlab/ci/               # Modular CI pipeline (path-based triggering)
└── mise.toml                 # Task runner
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Control Plane | 8000 | Application inventory, wave management, target components, user/pod access |
| Analysis Engine | 5000 | Risk assessment, wave pattern analysis, ATX code transformation |
| Frontend | 5173 | React SPA serving both services through a unified interface |

## Prerequisites

- Python 3.11+
- Node.js 20+
- Terraform 1.14.6
- AWS CLI v2
- Docker
- [mise](https://mise.jdx.dev/) (task runner)

## Quick Start

```bash
mise install
mise run setup

# Start services
mise run control-plane:start    # port 8000
mise run analysis:start         # port 5000
mise run frontend:start         # port 5173
```

## Authentication

Authentication uses AWS Cognito with PKCE flow:
- ALB validates OIDC tokens in production
- Cognito User Pool manages users and groups
- Group-based authorization (admin, proserve, viewer personas)
- Local development supports mock auth mode (`APP_ENV=development`)

## CI/CD

GitLab CI with path-based change detection — modifying `services/analysis-engine/` only triggers the analysis pipeline; modifying `services/control-plane/` or `frontend/` only triggers the platform pipeline.

### Pipeline Stages

1. verify — linting, formatting, pre-commit
2. security — static analysis (Bandit, Checkov, ASH)
3. plan — Terraform init, validate, plan
4. apply — Terraform apply
5. backend-deploy — Docker build → ECR → ECS rolling deploy
6. frontend-deploy — Build → S3 → CloudFront invalidation

## Infrastructure Deploy Order

Platform infrastructure deploys first (ALB, Cognito, shared DynamoDB tables) and publishes outputs to SSM. Analysis infrastructure reads those SSM parameters — no hardcoded cross-references.

## Acronym Glossary

| Acronym | Meaning |
|---------|---------|
| ARA | Application Replatform Analyzer — risk and pattern assessment engine |
| ATX | AWS Transform — automated code transformation service |
| DMO | Database Migration Orchestrator — database migration planning module |
| EOSL | End of Service Life — software reaching end of vendor support |
| PAM | Portfolio Assessment & Migration — wave planning and portfolio management |
| SCM | Source Code Management — repository analysis and dependency discovery |
| SMO | Storage Migration Orchestrator — storage migration planning module |
| UNO | Unified Orchestrator — the platform that ties all modules together |

## Environment Configuration

Each environment directory contains:
- `*-backend.tfbackend` — S3 state backend config
- `*-terraform.tfvars` — Variable values for that environment

Copy `.env.example` files in each service directory to `.env` for local development.
