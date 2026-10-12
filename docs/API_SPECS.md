# ARA API Specification

Full API reference for the Application Replatform Analyzer.

Base URL: `http://localhost:8000`

## Interactive Documentation

FastAPI auto-generates interactive docs:

| Tool | URL | Description |
|------|-----|-------------|
| Swagger UI | [/docs](http://localhost:8000/docs) | Interactive API explorer with try-it-out |
| ReDoc | [/redoc](http://localhost:8000/redoc) | Clean read-only API reference |
| OpenAPI JSON | [/openapi.json](http://localhost:8000/openapi.json) | Machine-readable spec (import into Postman, Insomnia, etc.) |

```bash
# Download the OpenAPI spec
curl http://localhost:8000/openapi.json -o openapi.json

# Import into Postman:
# Import > Link > http://localhost:8000/openapi.json
```

## Authentication

All endpoints require authentication via one of:
- `X-Amzn-Oidc-Data` header — ALB OIDC JWT token (production)
- `X-Dev-Mode: privileged|viewer` header — local development only

Write operations (POST, PATCH, DELETE) require `privileged` access.

## S3 Configuration

ARA uses two S3 buckets:

| Bucket | Env Var | Purpose |
|--------|---------|---------|
| `haf-ara-dev-assets-{ACCOUNT_ID}` | `S3_ASSETS_BUCKET` | Wave analysis reports, risk assessment reports |
| `haf-uno-data-plane-dev-assets-{ACCOUNT_ID}` | `S3_NOTES_BUCKET` | Notes and ATX files (managed by UNO) |

The `S3_NOTES_BUCKET` is used by the ATX transformations endpoint to read ATX files uploaded through UNO's Notes service.

---

## Risk Assessment API

Prefix: `/api/v1/ara/risk`

### POST `/assess` — Run risk assessment

Request body:
```json
{
  "application_id": "string",
  "readiness_inputs": {
    "team_availability": "string",
    "skill_level": "string",
    "knowledge_transfer": "string",
    "training_completed": true,
    "maintenance_window": "string",
    "business_calendar": "string",
    "stakeholder_alignment": "string",
    "budget_availability": "string"
  }
}
```

Exactly one of `application_id`, `pod_id`, or `wave_id` must be provided.

Readiness inputs can also be split into separate objects:
- `team_readiness_inputs` — team_availability, skill_level, knowledge_transfer, training_completed
- `business_readiness_inputs` — maintenance_window, business_calendar, stakeholder_alignment, budget_availability

### POST `/assess/parallel` — Parallel assessment

Request body:
```json
{
  "application_ids": ["app-1", "app-2"],
  "max_workers": 5,
  "readiness_inputs": { ... }
}
```

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| application_ids | string[] | yes | — | min 1 item |
| max_workers | int | no | 5 | 1–20 |
| readiness_inputs | object | no | null | Same as `/assess` |

### GET `/assessments` — List assessments

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| app_id | string | no | Filter by application ID |
| limit | int | no | Max results to return |

### GET `/assessments/latest` — Latest assessment for an app

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| app_id | string | yes | Application ID |

### GET `/assessments/{assessment_id}` — Get assessment by ID

| Path Param | Type | Description |
|------------|------|-------------|
| assessment_id | string | Assessment UUID |

### GET `/report/{assessment_id}` — Full report from S3

| Path Param | Type | Description |
|------------|------|-------------|
| assessment_id | string | Assessment UUID |

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| format | string | json | `json` or `html` |
| save | bool | false | Save HTML to S3 |

### GET `/summary` — Risk summary across all apps

No parameters. Returns aggregated risk metrics.

### GET `/complexity/{app_id}` — Complexity score

| Path Param | Type | Description |
|------------|------|-------------|
| app_id | string | Application ID |

### GET `/readiness/{app_id}` — Readiness score

| Path Param | Type | Description |
|------------|------|-------------|
| app_id | string | Application ID |

### GET `/actionable-items/{app_id}` — Actionable items

| Path Param | Type | Description |
|------------|------|-------------|
| app_id | string | Application ID |

---

## Pattern Analysis API

Prefix: `/api/v1/ara/patterns`

### GET `/` — List patterns

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| wave_id | string | no | Filter by wave |
| types | string | no | Filter by pattern type |
| complexity_levels | string | no | Filter by complexity |
| search | string | no | Search term |

### GET `/{pattern_id}` — Get pattern by ID

| Path Param | Type | Description |
|------------|------|-------------|
| pattern_id | string | Pattern ID (e.g. `PATTERN_ABC123`) |

### POST `/{pattern_id}/generate-atx` — Generate ATX for a pattern

| Path Param | Type | Description |
|------------|------|-------------|
| pattern_id | string | Pattern ID |

### POST `/wave/{wave_id}/analyze` — Run wave pattern analysis

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |

Request body:
```json
{
  "similarity_threshold": 70
}
```

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| similarity_threshold | int | no | 70 | 0–100 |

### GET `/wave/{wave_id}/analysis` — Get latest wave analysis

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |

| Query Param | Type | Required | Description |
|-------------|------|----------|-------------|
| analysis_id | string | no | Specific analysis ID (default: latest) |

### GET `/wave/{wave_id}/analyses` — List all wave analyses

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |

### GET `/wave/{wave_id}/analysis/{analysis_id}/report` — Analysis report

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |
| analysis_id | string | Analysis ID |

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| format | string | json | `json` or `html` |

### GET `/atx/transformations` — Get ATX transformations

No parameters. Returns available ATX transformation definitions.

### POST `/wave/{wave_id}/atx-mappings` — Submit ATX mappings

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |

Request body:
```json
{
  "mappings": [
    {
      "pattern_id": "PATTERN_ABC123",
      "application_id": "app-1",
      "application_name": "My App",
      "strategy": "UPGRADE",
      "transformation_instructions": "...",
      "atx_name": "atx-linux-upgrade",
      "atx_description": "Linux OS upgrade transformation"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| mappings | ATXMapping[] | yes | Min 1 mapping |
| mappings[].pattern_id | string | yes | Pattern ID |
| mappings[].application_id | string | yes | Application ID |
| mappings[].application_name | string | yes | Application name |
| mappings[].atx_name | string | yes | ATX transformation name |
| mappings[].strategy | string | no | Migration strategy |
| mappings[].transformation_instructions | string | no | Instructions |
| mappings[].atx_description | string | no | ATX description |

### GET `/wave/{wave_id}/atx-mappings` — Get ATX mappings

| Path Param | Type | Description |
|------------|------|-------------|
| wave_id | string | Wave ID |

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| include_all | bool | false | Include all mappings regardless of status |

---

## Application Status API

Prefix: `/api/v1/ara/applications`

### GET `/{application_id}/status` — Get lifecycle status

Response:
```json
{
  "success": true,
  "application_id": "app-1",
  "onboarding_status": "COMPLETED",
  "risk_assessment_status": "COMPLETED",
  "wave_analysis_status": "IN_PROGRESS",
  "atx_mapping_status": "NOT_STARTED",
  "timestamps": {
    "onboarding_completed_at": "2026-03-01T10:00:00",
    "risk_assessment_started_at": "2026-03-02T09:00:00",
    "risk_assessment_completed_at": "2026-03-02T09:15:00",
    "wave_analysis_started_at": "2026-03-03T14:00:00",
    "wave_analysis_completed_at": null,
    "atx_mapping_assigned_at": null,
    "atx_mapping_completed_at": null
  }
}
```

### PATCH `/{application_id}/status` — Update status field

Request body:
```json
{
  "field": "risk_assessment_status",
  "status": "COMPLETED"
}
```

| Field | Type | Required | Valid Values |
|-------|------|----------|-------------|
| field | string | yes | `risk_assessment_status`, `wave_analysis_status`, `atx_mapping_status` |
| status | string | yes | Status value for the field |

### POST `/{application_id}/clear-atx` — Clear ATX mapping

Clears ATX mapping and resets wave analysis status. Requires `privileged` access.

### POST `/{application_id}/reset` — Reset completed application

Resets a completed application to allow re-analysis. Requires `privileged` access.

### POST `/bulk-clear-atx` — Bulk clear ATX mappings

### POST `/bulk-mark-complete` — Bulk mark applications complete

### POST `/bulk-reset` — Bulk reset applications

All three bulk endpoints use the same request body:
```json
{
  "application_ids": ["app-1", "app-2", "app-3"]
}
```

Response:
```json
{
  "success": true,
  "success_count": 2,
  "failed_count": 1,
  "errors": ["Error for app-3: ..."]
}
```

---

## ATX Code Analysis API

Prefix: `/api/v1/ara/atx`

### POST `/run` — Submit ATX code analysis

Request body:
```json
{
  "application_ids": ["23095", "22763"],
  "selected_files": {"23095": ["notes/atx-static-prompts/all/file.md"]},
  "selected_repos": {"23095": ["https://github.com/org/repo.git"]}
}
```

### GET `/tasks` — List/get processing tasks

| Query Param | Type | Description |
|-------------|------|-------------|
| task_id | string | Get single task |
| app_id | string | Filter by application |

### GET `/applications/{app_id}` — App ATX data (lazy load)

| Query Param | Type | Description |
|-------------|------|-------------|
| include | string | Comma-separated: status, files, results, assessments |

### POST `/status` — Bulk status check

Request body: `["23095", "22763"]`
Response: `{"statuses": {"23095": "completed", "22763": "in_progress"}}`

### GET `/download/{app_id}/{run_id}` — Download files

| Query Param | Type | Description |
|-------------|------|-------------|
| file | string | Relative path for single file (returns presigned URL) |
| zip | bool | Download entire run as zip |

### GET `/config` — ATX configuration

Returns: `{"transformation_name": "AWS/comprehensive-codebase-analysis"}`

---

## Health Endpoints

| Method | Path | Response |
|--------|------|----------|
| GET | `/` | `{ "service": "Application Replatform Analyzer", "status": "running", "endpoints": {...} }` |
| GET | `/health` | `{ "status": "healthy" }` |
| GET | `/api/health` | `{ "status": "healthy", "api": "v1" }` |

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Description of what went wrong",
  "details": [{ "field": "application_id", "message": "Field required" }]
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad request / validation error |
| 401 | Unauthorized (missing or invalid auth) |
| 403 | Forbidden (viewer trying write operation) |
| 404 | Resource not found |
| 500 | Internal server error |
