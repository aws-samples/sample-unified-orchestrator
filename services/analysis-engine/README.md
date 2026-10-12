# Analysis Engine

FastAPI backend for application analysis and code transformation.

## Responsibilities

- Risk assessment (AI-powered via Strands Agents + Bedrock)
- Wave pattern analysis and discovery
- ATX code transformation (repo cloning, dependency ordering)
- Combined phased analysis (multi-repo dependency graphs)
- Application lifecycle status management

## Local Development

```bash
mise run analysis:start    # port 5000
mise run analysis:test
```

## Authentication

Uses Cognito JWT validation via the shared `haf-uno-auth` package. Set `APP_ENV=development` for mock auth locally.
