#!/usr/bin/env bash
# Starts the HireFlow API and web app together.
set -e
cd "$(dirname "$0")"

if [ ! -d api/.venv ]; then
  echo "→ creating python venv"
  python3 -m venv api/.venv
  api/.venv/bin/pip install -q -r api/requirements.txt
fi
if [ ! -d web/node_modules ]; then
  echo "→ installing web dependencies"
  (cd web && npm install)
fi

if [ -f api/.env ]; then set -a; . api/.env; set +a; fi

echo "→ API on http://127.0.0.1:8000"
(cd api && ../api/.venv/bin/uvicorn main:app --port 8000) &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT

echo "→ web on http://localhost:5173"
(cd web && npm run dev)
