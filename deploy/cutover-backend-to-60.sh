#!/usr/bin/env bash
# Cutover backend on 172.28.92.57 to use DB on 172.28.92.60.
# Run AFTER migrate-db-to-60.sh restore/verify succeeded.
#
# Usage (on .57):
#   DATABASE_URL=postgresql://hub:password@172.28.92.60:5432/downstream_hub bash deploy/cutover-backend-to-60.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/downstream-hub}"
BRANCH="${BRANCH:-sit}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to postgresql://hub:password@172.28.92.60:5432/downstream_hub"
  exit 1
fi

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "Stopping backend ..."
docker compose -f deploy/docker-compose.backend.yml stop backend

if grep -q '^DATABASE_URL=' Backend/.env; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" Backend/.env
else
  echo "DATABASE_URL=${DATABASE_URL}" >> Backend/.env
fi

docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate backend

echo -n "GET /health: "
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/health || true

echo "Check logs: docker compose -f deploy/docker-compose.backend.yml logs backend --tail 50"
