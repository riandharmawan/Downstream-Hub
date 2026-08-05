#!/usr/bin/env bash
# App server (.56): rebuild frontend for proxy mode on public 3010 and reload Nginx.
# Usage: sudo bash deploy/rebuild-frontend-staging-proxy.sh
# Env: REPO_DIR (default /opt/downstream-hub), BRANCH (default sit),
#      PUBLIC_URL (health-check URL, default http://172.28.92.56:3010),
#      VITE_API_URL (frontend build arg; default empty = same-origin API)

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/downstream-hub}"
BRANCH="${BRANCH:-sit}"
PUBLIC_URL="${PUBLIC_URL:-http://172.28.92.56:3010}"
VITE_API_URL="${VITE_API_URL:-}"

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.frontend.yml build --no-cache --build-arg "VITE_API_URL=${VITE_API_URL}"
docker compose -f deploy/docker-compose.frontend.yml up -d

cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf
nginx -t
systemctl reload nginx || (systemctl enable nginx && systemctl start nginx)

echo -n "GET / HTTP status: "
curl -s -o /dev/null -w "%{http_code}\n" "${PUBLIC_URL}"
echo -n "GET /api/sso/jwks HTTP status: "
curl -s -o /dev/null -w "%{http_code}\n" "${PUBLIC_URL}/api/sso/jwks"
