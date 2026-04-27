# Staging deploy — two servers (pull + Docker)

Runbook for updating **staging** after code is pushed to GitHub: **backend + PostgreSQL** on one host and **frontend** on another.

| Role | IP | Stack |
|------|-----|--------|
| Backend + database | `172.28.92.57` | `deploy/docker-compose.backend.yml` |
| App (frontend) | `172.28.92.56` | `deploy/docker-compose.frontend.yml` |

**First-time setup** (clone, `.env`, firewall): see [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md). **Secrets** on the host: [STAGING-SECRETS-AND-KEYS.md](../Plan/STAGING-SECRETS-AND-KEYS.md).

---

## Layout

- Install path on both servers: `/opt/downstream-hub` (full repo clone).
- Default staging branch in docs: `sit` — set `BRANCH` below to match your workflow (`main`, etc.).
- PostgreSQL is exposed on the **backend host** as **host port 5434** → container `5432` (see `deploy/docker-compose.backend.yml`).

---

## 1) Backend + DB server — `172.28.92.57`

SSH to `172.28.92.57`, then run:

```bash
#!/bin/bash
set -euo pipefail
REPO_DIR=/opt/downstream-hub
BRANCH=sit

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate
```

**Notes**

- `Backend/.env` and repo-root `.env` (e.g. `POSTGRES_*`) must already exist on the server; they are not in Git.
- Migrations run when the backend container starts (see [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md) §5.4).
- **Uploads:** staging compose mounts `Backend/uploads` into the API container. The image creates `/app/uploads` with correct ownership for user `nodejs` (UID 1001). On the host, ensure that directory is writable by the container: after first clone or if you see `EACCES` on `/app/uploads/app-icons`, run **`sudo bash deploy/rebuild-backend-staging.sh`** from the repo root (pull + `chown 1001:1001` + rebuild backend), or run the same `mkdir` / `chown` / `docker compose` steps manually.

**Health check (on .57)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/health
```

---

## 2) App server — `172.28.92.56` (proxy mode on `3010`)

SSH to `172.28.92.56`, then run:

```bash
#!/bin/bash
set -euo pipefail
REPO_DIR=/opt/downstream-hub
BRANCH=sit

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.56:3010
docker compose -f deploy/docker-compose.frontend.yml up -d

sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf
sudo nginx -t
sudo systemctl reload nginx
```

Or use helper script (as root): `bash deploy/rebuild-frontend-staging-proxy.sh`.

**Notes**

- `VITE_API_URL` is a **build-time** argument. Rebuild the frontend image whenever the public API base URL changes.
- Proxy mode keeps browser traffic on one origin (`.56:3010`) while Nginx forwards `/api` to `.57:4000`.
- In proxy mode, frontend container binds host `3100` and Nginx binds public `3010`.

**Health check (on .56)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010/api/sso/jwks
```

---

## 3) Deploy order

1. **172.28.92.57** — backend + Postgres (API available for the new frontend build if needed).
2. **172.28.92.56** — frontend + Nginx proxy (rebuild with `VITE_API_URL=http://172.28.92.56:3010`).

---

## 4) Optional: one-liners (no script file)

**172.28.92.57**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate
```

**172.28.92.56**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.56:3010 && docker compose -f deploy/docker-compose.frontend.yml up -d && sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf && sudo nginx -t && sudo systemctl reload nginx
```

---

## 5) Logs

**Backend host**

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.backend.yml logs -f --tail=200
```

**Frontend host**

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.frontend.yml logs -f --tail=200
```

---

## 6) Network lockdown for backend `4000`

After proxy mode is verified, lock backend access so only app server `.56` can reach `.57:4000`.

- Security group: allow inbound TCP `4000` on `.57` from source `172.28.92.56/32` (or internal VPC CIDR), remove broad sources.
- Host firewall (`.57`) should mirror that allow-list if enabled.
- Verify from `.56`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://172.28.92.57:4000/health
```

---

## 7) OIDC completion checklist (staging)

- App UI opens from `http://172.28.92.56:3010`.
- Browser network calls stay on `.56:3010` (including `/api/...`).
- Discovery and JWKS work via proxy:

```bash
curl -i http://172.28.92.56:3010/api/sso/.well-known/openid-configuration
curl -i http://172.28.92.56:3010/api/sso/jwks
```

- `issuer` in discovery must match staging public URL.
- Downstream client redirect URI and client ID must match staging registration.
- End-to-end login with downstream app succeeds and validates ID token using JWKS.

---

## Related

| Topic | Doc |
|--------|-----|
| Proxy mode server config (copy-paste) | [STAGING-PROXY-SERVER-CONFIG.md](./STAGING-PROXY-SERVER-CONFIG.md) |
| Deploy package file list | [deploy/README.md](../../deploy/README.md) |
| Full Alicloud Docker guide | [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md) |
| Local rebuild / SSO checks | [REBUILD-RESTART-APPS-DOCKER.md](./REBUILD-RESTART-APPS-DOCKER.md) |
