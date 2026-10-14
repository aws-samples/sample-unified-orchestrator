# Frontend

React + TypeScript SPA built with Vite. Provides a unified interface for portfolio management, wave planning, risk assessment, and code transformation.

## Local Development

```bash
mise run frontend:start    # port 5173
mise run frontend:test
mise run frontend:build
```

## Backend Proxy

Vite dev server proxies API requests to both backends:

```
/api/v1/applications, /api/v1/waves  →  Control Plane (localhost:8000)
/api/v1/ara/*                        →  Analysis Engine (localhost:5000)
```

Configure backend URLs in `frontend/.env`:
```env
VITE_API_URL=http://localhost:8000
VITE_ARA_API_URL=http://localhost:5000
```
