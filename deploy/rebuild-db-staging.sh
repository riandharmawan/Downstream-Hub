#!/usr/bin/env bash
# DB host (172.28.92.60): pull latest, recreate Postgres container.
# Usage: sudo bash deploy/rebuild-db-staging.sh
# Env: REPO_DIR (default /opt/downstream-hub), BRANCH (default sit).

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/downstream-hub}"
BRANCH="${BRANCH:-sit}"

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.db.yml up -d --force-recreate

echo -n "Postgres health: "
docker exec downstream-hub-db pg_isready -U "${POSTGRES_USER:-hub}" -d "${POSTGRES_DB:-downstream_hub}" || echo "(pg_isready failed)"
