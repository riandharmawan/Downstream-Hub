#!/usr/bin/env bash
# Migrate staging Postgres from backend host (.57) to dedicated DB host (.60).
# Run Phase A from a machine that can SSH to both hosts (or run each section on the named host).
#
# Prerequisites:
#   - Source: downstream-hub-db running on 172.28.92.57 (legacy co-located stack)
#   - Target: deploy/docker-compose.db.yml running on 172.28.92.60
#   - Same POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB on both hosts
#   - Firewall: .57 allowed to reach .60:5432
#
# Usage:
#   bash deploy/migrate-db-to-60.sh dump      # on .57 — create dump
#   bash deploy/migrate-db-to-60.sh copy      # copy dump .57 → .60 (needs scp)
#   bash deploy/migrate-db-to-60.sh restore   # on .60 — restore into new DB
#   bash deploy/migrate-db-to-60.sh verify    # on .60 — list tables and user count

set -euo pipefail

SOURCE_HOST="${SOURCE_HOST:-172.28.92.57}"
TARGET_HOST="${TARGET_HOST:-172.28.92.60}"
DUMP_PATH="${DUMP_PATH:-/tmp/downstream_hub.dump}"
DB_CONTAINER="${DB_CONTAINER:-downstream-hub-db}"
PGUSER="${POSTGRES_USER:-hub}"
PGDB="${POSTGRES_DB:-downstream_hub}"

cmd="${1:-}"

case "$cmd" in
  dump)
    echo "Creating dump on $SOURCE_HOST ..."
    docker exec "$DB_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" -Fc -f /tmp/downstream_hub.dump
    docker cp "$DB_CONTAINER:/tmp/downstream_hub.dump" "$DUMP_PATH"
    echo "Dump written to $DUMP_PATH"
    ;;
  copy)
    echo "Copying dump to $TARGET_HOST:$DUMP_PATH ..."
    scp "$DUMP_PATH" "root@${TARGET_HOST}:${DUMP_PATH}"
    ;;
  restore)
    echo "Restoring dump on $TARGET_HOST ..."
    docker cp "$DUMP_PATH" "${DB_CONTAINER}:/tmp/downstream_hub.dump"
    docker exec "$DB_CONTAINER" pg_restore -U "$PGUSER" -d "$PGDB" --clean --if-exists /tmp/downstream_hub.dump
    echo "Restore complete."
    ;;
  verify)
    echo "Verifying database on $TARGET_HOST ..."
    docker exec -it "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -c "\dt"
    docker exec -it "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -c "SELECT count(*) AS users FROM users;"
    ;;
  *)
    echo "Usage: $0 {dump|copy|restore|verify}"
    exit 1
    ;;
esac
