#!/usr/bin/env bash
# Backend host (e.g. 172.28.92.57): pull latest, fix upload dir ownership, rebuild API image.
# Usage: sudo bash deploy/rebuild-backend-staging.sh
# Env: REPO_DIR (default /opt/downstream-hub), BRANCH (default sit).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/downstream-hub}"
BRANCH="${BRANCH:-sit}"

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

mkdir -p "$REPO_DIR/Backend/uploads/app-icons"
chown -R 1001:1001 "$REPO_DIR/Backend/uploads"

docker compose -f deploy/docker-compose.backend.yml build --no-cache backend
docker compose -f deploy/docker-compose.backend.yml up -d --force-recreate backend

echo -n "GET /health HTTP status: "
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4000/health" || echo "(curl failed)"
