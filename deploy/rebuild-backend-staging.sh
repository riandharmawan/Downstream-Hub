#!/usr/bin/env bash
# Backend host (172.28.92.57): pull latest, fix upload dir ownership, rebuild API container.
# Postgres runs on dedicated DB host 172.28.92.60 — ensure Backend/.env DATABASE_URL points there.
# Usage: sudo bash deploy/rebuild-backend-staging.sh
# Env: REPO_DIR (default /opt/downstream-hub), BRANCH (default sit).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/downstream-hub}"
BRANCH="${BRANCH:-sit}"

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

if ! grep -q '172.28.92.60' Backend/.env 2>/dev/null; then
  echo "WARNING: Backend/.env may not point at DB host 172.28.92.60 — check DATABASE_URL before continuing."
fi

mkdir -p "$REPO_DIR/Backend/uploads/app-icons"
chown -R 1001:1001 "$REPO_DIR/Backend/uploads"

docker compose -f deploy/docker-compose.backend.yml build --no-cache backend
docker compose -f deploy/docker-compose.backend.yml up -d --force-recreate backend

echo -n "GET /health HTTP status: "
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4000/health" || echo "(curl failed)"
