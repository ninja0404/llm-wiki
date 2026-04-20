#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT"

export POSTGRES_USER="${POSTGRES_USER:-llmwiki}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-llmwiki}"
export POSTGRES_DB="${POSTGRES_DB:-llmwiki}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost:9000}"
export MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
export MINIO_BUCKET="${MINIO_BUCKET:-llmwiki}"
export INTERNAL_SERVICE_TOKEN="${INTERNAL_SERVICE_TOKEN:-0123456789abcdef0123456789abcdef}"
export ACTIVE_KEY_VERSION="${ACTIVE_KEY_VERSION:-local-v1}"
if [[ -z "${KEYRING_JSON:-}" ]]; then
  KEY="$(python3 - <<'PY'
import base64
import secrets
print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))
PY
)"
  export KEYRING_JSON="{\"${ACTIVE_KEY_VERSION}\":\"${KEY}\"}"
fi

docker compose up -d postgres redis minio
python3 scripts/check_local_stack.py
python3 scripts/init_local_db.py --reset
ruff check .
pytest tests/unit tests/integration
pnpm --dir web install --frozen-lockfile
pnpm --dir web run lint
pnpm --dir web run build
