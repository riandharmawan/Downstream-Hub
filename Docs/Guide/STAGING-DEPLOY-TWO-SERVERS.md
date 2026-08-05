# Staging deploy — three servers (pull + Docker)

Runbook for updating **staging** after code is pushed to GitHub: **PostgreSQL** on a dedicated DB host, **backend API** on another, and **frontend** on the app server.

| Role | IP | Stack |
|------|-----|--------|
| App (frontend) | `172.28.92.56` | `deploy/docker-compose.frontend.yml` |
| Backend API | `172.28.92.57` | `deploy/docker-compose.backend.yml` |
| PostgreSQL | `172.28.92.60` | `deploy/docker-compose.db.yml` |

**First-time setup** (clone, `.env`, firewall): see [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md). **DB migration from legacy co-located stack:** [STAGING-DB-MIGRATION.md](./STAGING-DB-MIGRATION.md). **Secrets** on the host: [STAGING-SECRETS-AND-KEYS.md](../Plan/STAGING-SECRETS-AND-KEYS.md).

---

## Layout

- Install path on all servers: `/opt/downstream-hub` (full repo clone).
- Default staging branch in docs: `sit` — set `BRANCH` below to match your workflow (`main`, etc.).
- PostgreSQL runs on **172.28.92.60** at host port **5432**.
- Backend on **172.28.92.57** connects via `DATABASE_URL` in `Backend/.env` (must include `@172.28.92.60:5432`).

---

## 1) Database server — `172.28.92.60`

SSH to `172.28.92.60`, then run:

```bash
#!/bin/bash
set -euo pipefail
REPO_DIR=/opt/downstream-hub
BRANCH=sit

cd "$REPO_DIR"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

docker compose -f deploy/docker-compose.db.yml up -d --force-recreate
```

Or use helper script: `sudo bash deploy/rebuild-db-staging.sh`.

**First-time only**

```bash
cp deploy/env.db.example .env
# Edit .env — set POSTGRES_PASSWORD (same value used in Backend/.env on .57)
docker compose -f deploy/docker-compose.db.yml up -d
sudo bash deploy/setup-db-firewall.sh   # optional ADMIN_IP=your.ip.here
```

**Health check (on .60)**

```bash
docker exec downstream-hub-db pg_isready -U hub -d downstream_hub
docker exec -it downstream-hub-db psql -U hub -d downstream_hub -c "\dt"
```

---

## 2) Backend server — `172.28.92.57`

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

docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate backend
```

Or use helper script: `sudo bash deploy/rebuild-backend-staging.sh`.

**Notes**

- `Backend/.env` must exist and include `DATABASE_URL=postgresql://hub:<password>@172.28.92.60:5432/downstream_hub`.
- Repo-root `.env` with `POSTGRES_*` is **not** required on `.57` (only on `.60`).
- Migrations run when the backend container starts (see [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md) §6).
- **Uploads:** staging compose mounts `Backend/uploads` into the API container. After first clone or `EACCES` on uploads, run **`sudo bash deploy/rebuild-backend-staging.sh`**.

**Health check (on .57)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/health
docker compose -f deploy/docker-compose.backend.yml logs backend --tail 50
```

---

## 3) App server — `172.28.92.56` (proxy mode on `3010`)

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

Or use helper script: `bash deploy/rebuild-frontend-staging-proxy.sh`.

**Notes**

- `VITE_API_URL` is a **build-time** argument. Rebuild the frontend image whenever the public API base URL changes.
- Proxy mode keeps browser traffic on one origin (`.56:3010`) while Nginx forwards `/api` to `.57:4000`.
- **No change** is required on `.56` for the DB split unless you are also updating docs or domain URLs.

**Health check (on .56)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010/api/sso/jwks
```

---

## 4) Deploy order

1. **172.28.92.60** — PostgreSQL (must be up before backend starts).
2. **172.28.92.57** — backend API (needs `DATABASE_URL` pointing at `.60`).
3. **172.28.92.56** — frontend + Nginx proxy (only if frontend/nginx config changed).

---

## 5) Optional: one-liners (no script file)

**172.28.92.60**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.db.yml up -d --force-recreate
```

**172.28.92.57**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate backend
```

**172.28.92.56**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.56:3010 && docker compose -f deploy/docker-compose.frontend.yml up -d && sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf && sudo nginx -t && sudo systemctl reload nginx
```

---

## 6) Logs

**DB host**

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.db.yml logs -f --tail=200
```

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

## 7) Network lockdown

| Source | Target | Port | Purpose |
|--------|--------|------|---------|
| `172.28.92.56` | `172.28.92.57` | 4000 | Nginx → backend API |
| `172.28.92.57` | `172.28.92.60` | 5432 | Backend → PostgreSQL |
| Admin IP (optional) | `172.28.92.60` | 5432 | pgAdmin from PC |

See [STAGING-DB-MIGRATION.md](./STAGING-DB-MIGRATION.md) for firewall scripts and Alibaba Cloud security group notes.

**Verify from `.56`:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://172.28.92.57:4000/health
```

---

## 8) OIDC completion checklist (staging)

- App UI opens from `http://172.28.92.56:3010` (or your domain).
- Browser network calls stay on the public origin (including `/api/...`).
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
| DB migration from legacy .57 co-located Postgres | [STAGING-DB-MIGRATION.md](./STAGING-DB-MIGRATION.md) |
| Proxy mode server config (copy-paste) | [STAGING-PROXY-SERVER-CONFIG.md](./STAGING-PROXY-SERVER-CONFIG.md) |
| Deploy package file list | [deploy/README.md](../../deploy/README.md) |
| Full Alicloud Docker guide | [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md) |
| Local rebuild / SSO checks | [REBUILD-RESTART-APPS-DOCKER.md](./REBUILD-RESTART-APPS-DOCKER.md) |
