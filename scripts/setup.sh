#!/usr/bin/env bash
# =============================================================================
# Platform Setup — Install dependencies and create .env files
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Platform Setup"
echo ""

cd "$ROOT_DIR"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> Installing control-plane dependencies..."
pip install -r services/control-plane/requirements.txt

echo "==> Installing analysis-engine dependencies..."
pip install -r services/analysis-engine/requirements.txt

echo "==> Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
[ -f "package.json" ] && npm install || echo "  (no package.json — skipping)"

echo "==> Installing pre-commit hooks..."
cd "$ROOT_DIR"
pre-commit install || echo "  (pre-commit not available)"

# Create .env files from examples
for envfile in services/control-plane/.env.example services/analysis-engine/.env.example frontend/.env.example; do
  target="${envfile%.example}"
  if [ -f "$envfile" ] && [ ! -f "$target" ]; then
    cp "$envfile" "$target"
    echo "  Created $target"
  fi
done

echo ""
echo "==> Setup complete!"
echo "  mise run control-plane:start    # port 8000"
echo "  mise run analysis:start         # port 5000"
echo "  mise run frontend:start         # port 5173"
