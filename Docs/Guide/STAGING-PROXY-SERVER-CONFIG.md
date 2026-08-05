# Staging proxy server config (`3010` public)

This guide configures staging so browsers call only `172.28.92.56:3010` and Nginx proxies `/api` to `172.28.92.57:4000`.

## Target architecture

- Public UI + API entrypoint: `http://172.28.92.56:3010`
- Frontend container host binding on `.56`: `3100 -> 3000`
- Backend API on `.57`: `4000`
- PostgreSQL on `.60`: `5432` (not proxied through Nginx — backend connects directly)

## 1) App server `.56` — apply proxy config

```bash
cd /opt/downstream-hub
git fetch origin
git checkout sit
git pull origin sit

# frontend image must be built with same-origin API URL
docker compose -f deploy/docker-compose.frontend.yml build --no-cache --build-arg VITE_API_URL=http://172.28.92.56:3010
docker compose -f deploy/docker-compose.frontend.yml up -d

# install nginx proxy config
sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf
sudo nginx -t
sudo systemctl reload nginx || (sudo systemctl enable nginx && sudo systemctl start nginx)
```

Verify on `.56`:

```bash
curl -i http://127.0.0.1:3010
curl -i http://127.0.0.1:3010/api/sso/jwks
curl -i http://127.0.0.1:3010/api/sso/.well-known/openid-configuration
```

Expected: HTTP `200` for all.

## 2) Backend server `.57` — health before lock-down

```bash
curl -i http://127.0.0.1:4000/health
docker ps --filter name=downstream-hub-api
```

Expected: API container `Up` and `/health` returns `200`.

## 3) Security lock-down on `.57` (after proxy works)

Set network policy so only `.56` can call `.57:4000`.

- Security group inbound rule on `.57`: TCP `4000`, source `172.28.92.56/32` (or internal VPC CIDR).
- Remove broad source rules for port `4000` once verified.
- If host firewall is enabled, mirror the same allow-list.

Example host firewall commands on `.57` (firewalld):

```bash
# keep 4000 reachable only from app server
sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=172.28.92.56/32 port protocol=tcp port=4000 accept'
sudo firewall-cmd --permanent --remove-port=4000/tcp
sudo firewall-cmd --reload
```

Connectivity check from `.56`:

```bash
curl -i http://172.28.92.57:4000/health
```

Expected: `200`.

## 4) OIDC validation on staging

From a browser on allowed network:

1. Open `http://172.28.92.56:3010`.
2. In DevTools Network, confirm API calls are to `.56:3010/api/...` (not `.57:4000`).
3. Validate discovery and JWKS via proxy:
   - `GET /api/sso/.well-known/openid-configuration`
   - `GET /api/sso/jwks`
4. Verify `issuer` and endpoint URLs match staging public URL.
5. Complete downstream app login flow and verify ID token validation via JWKS.

## 5) Domain name access (e.g. test-dwshub.kpndomain.com)

If users open the Hub via a DNS name instead of `172.28.92.56:3010`, the frontend **must not** call the API on a different host. Rebuild with **same-origin** API (empty `VITE_API_URL`):

```bash
# On app server .56
cd /opt/downstream-hub
git pull origin sit
PUBLIC_URL=http://test-dwshub.kpndomain.com VITE_API_URL= sudo bash deploy/rebuild-frontend-staging-proxy.sh
```

On backend `.57`, set public URLs to the domain and allow HTTP session cookies:

```env
SSO_ISSUER=http://test-dwshub.kpndomain.com
API_PUBLIC_URL=http://test-dwshub.kpndomain.com
AUTH_COOKIE_SECURE=0
```

Recreate the backend container after editing `.env`. Users must **log in again** on the domain so cookies are set for the correct host.

Ensure Nginx proxies **`/uploads/`** to the backend (included in `deploy/nginx-frontend-with-api-proxy.conf`) so uploaded icons display.

Verify in browser DevTools → Network:

- Page URL: `http://test-dwshub.kpndomain.com/...`
- API calls: `http://test-dwshub.kpndomain.com/api/...` (not `172.28.92.56:3010`)
- Icon URLs: `http://test-dwshub.kpndomain.com/uploads/app-icons/...`

## 6) pgAdmin and DB host

- **pgAdmin:** Connect to **172.28.92.60:5432** (not `.57`). Credentials are in `/opt/downstream-hub/.env` on the DB host.
- Security group on `.60` must allow your admin IP on port 5432 if connecting from outside the VPC.

## 7) Troubleshooting

- Timeout from PC to `.57:4000` is expected after lock-down if client is not in allow-list.
- If browser still calls `.57:4000`, frontend was built with old `VITE_API_URL`; rebuild frontend with empty `VITE_API_URL` (same-origin) or matching domain.
- **401 on `/api/auth/me` when using a domain:** frontend was built with `VITE_API_URL=http://172.28.92.56:3010` while the page is on another host — session cookies are not sent. Rebuild with `VITE_API_URL=` and log in again on the domain.
- **401 after login on HTTP staging:** set `AUTH_COOKIE_SECURE=0` in backend `.env` when not using HTTPS.
- If proxy path fails, run `sudo nginx -t` and check `sudo journalctl -u nginx -n 100 --no-pager`.
