#!/usr/bin/env bash
# =============================================================================
# Platform Start — Run all services for local development
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Starting platform services..."
# shellcheck disable=SC1091
source "$ROOT_DIR/.venv/bin/activate" 2>/dev/null || true

cd "$ROOT_DIR/services/control-plane"
python run.py &
CP_PID=$!

cd "$ROOT_DIR/services/analysis-engine"
python run.py &
AE_PID=$!

cd "$ROOT_DIR/frontend"
[ -f "package.json" ] && npm run dev &
FE_PID=$!

echo ""
echo "==> Services running:"
echo "  Control Plane:    http://localhost:8000 (PID: $CP_PID)"
echo "  Analysis Engine:  http://localhost:5000 (PID: $AE_PID)"
echo "  Frontend:         http://localhost:5173 (PID: ${FE_PID:-N/A})"
echo ""
echo "Press Ctrl+C to stop all."
wait
