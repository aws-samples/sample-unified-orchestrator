# Control Plane

FastAPI backend for the platform's control plane operations.

## Responsibilities

- Application inventory management (CRUD, bulk import)
- Wave planning and target component assignment
- User management and pod-based access control
- Server inventory collection
- DynamoDB data plane operations

## Local Development

```bash
mise run control-plane:start    # port 8000
mise run control-plane:test
```

## Authentication

Uses Cognito JWT validation via the shared `haf-uno-auth` package. Set `APP_ENV=development` for mock auth locally.
