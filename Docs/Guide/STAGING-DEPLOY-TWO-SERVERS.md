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

## 2) App server — `172.28.92.56`

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

docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.57:4000
docker compose -f deploy/docker-compose.frontend.yml up -d
```

**Notes**

- `VITE_API_URL` is a **build-time** argument. Rebuild the frontend image whenever the public API base URL changes.
- Default UI URL: `http://172.28.92.56:3010`.

**Health check (on .56)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010
```

---

## 3) Deploy order

1. **172.28.92.57** — backend + Postgres (API available for the new frontend build if needed).
2. **172.28.92.56** — frontend (rebuild so it matches the API URL you pass in).

---

## 4) Optional: one-liners (no script file)

**172.28.92.57**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate
```

**172.28.92.56**

```bash
cd /opt/downstream-hub && git fetch origin && git checkout sit && git pull origin sit && docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.57:4000 && docker compose -f deploy/docker-compose.frontend.yml up -d
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

## Related

| Topic | Doc |
|--------|-----|
| Deploy package file list | [deploy/README.md](../../deploy/README.md) |
| Full Alicloud Docker guide | [DEPLOYMENT-ALICLOUD-DOCKER.md](../DEPLOYMENT-ALICLOUD-DOCKER.md) |
| Local rebuild / SSO checks | [REBUILD-RESTART-APPS-DOCKER.md](./REBUILD-RESTART-APPS-DOCKER.md) |
