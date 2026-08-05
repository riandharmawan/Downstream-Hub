# Downstream Hub — Project resume summary

**Purpose:** Summary of work done (late Feb – early Mar 2026) so you can resume the project later. Give this document (or its path) to your assistant when you return.

**Repo:** https://github.com/riandharmawan/Downstream-Hub (branch: **sit**)

---

## 1. What is this project?

- **Downstream Hub:** Central portal for employees to discover and open internal apps with SSO.
- **Stack:** React (Vite) frontend, Node.js/Express backend, PostgreSQL, Docker optional.
- **Deployment:** Three Alibaba Cloud servers — **172.28.92.56** (frontend), **172.28.92.57** (backend API), **172.28.92.60** (PostgreSQL).

---

## 2. What was done (summary)

| Area | What was done |
|------|----------------|
| **Rate limiting** | Login and register endpoints rate-limited (express-rate-limit). Defaults: 20/15min login, 5/15min register. Configurable via env; 429 when exceeded. Relaxed in `NODE_ENV=test`. |
| **Pentest report** | [Docs/PENTEST-REPORT.md](PENTEST-REPORT.md) — findings fixed vs open (e.g. P-01 rate limiting fixed; P-11 security headers open). |
| **Deployment guides** | [Docs/DEPLOYMENT-ALICLOUD.md](DEPLOYMENT-ALICLOUD.md) (host Node/Nginx/Postgres), [Docs/DEPLOYMENT-ALICLOUD-DOCKER.md](DEPLOYMENT-ALICLOUD-DOCKER.md) (Docker, three servers). Ports: frontend **3010**, backend **4000** on `.57`, Postgres **5432** on `.60`. |
| **Deploy package** | **deploy/** — docker-compose.frontend.yml, docker-compose.backend.yml, docker-compose.db.yml, env examples, nginx configs, migration scripts. |
| **Option 2 — API via proxy** | Because the security group allows 172.28.92.57:4000 only from 172.28.92.56 and one other IP, the browser cannot call the backend directly. [Docs/DEPLOYMENT-OPTION2-API-PROXY.md](DEPLOYMENT-OPTION2-API-PROXY.md): Nginx on 172.28.92.56 listens on **3011**, proxies `/` to frontend container (3010) and `/api/` to 172.28.92.57:4000. Frontend rebuilt with `VITE_API_URL=http://172.28.92.56:3011`. Users open **http://172.28.92.56:3011** for both UI and API. |
| **SSO bridge URL** | Backend builds SSO bridge URL from **API_PUBLIC_URL**. Set to **http://172.28.92.56:3011** in Backend/.env (not 172.28.92.57) so the browser is redirected to the proxy; Nginx forwards to backend. After changing .env, **recreate** the backend container (`docker compose up -d --force-recreate backend`), not just restart. |
| **Backend .env gotcha** | Line 1 of Backend/.env had a stray character (e.g. `3#`) causing parse error. Comments must start with `#` only. [Docs/FIX-BACKEND-ENV.md](FIX-BACKEND-ENV.md) documents the fix. |
| **pgAdmin / DB access** | Staging Postgres is in Docker on **172.28.92.60**, port **5432**. Credentials in `/opt/downstream-hub/.env` on the DB host (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB). Security group must allow your IP to `.60:5432` for pgAdmin from PC. |
| **Git / push** | Code pushed to branch **sit**. Deploy folder and docs are in the repo. If the server lacks files, run `git pull origin sit` in `/opt/downstream-hub`. |
| **Standalone migrations** | Backend has `npm run migrate` (scripts/run-migrate.js) to run DB migrations without starting the server. |

---

## 3. Current state (as of pause)

- **Staging:** Frontend and backend are deployed and working.
  - **Frontend (Docker):** 172.28.92.56, served via Nginx proxy on **3011** (user-facing URL: http://172.28.92.56:3011).
  - **Backend (Docker):** 172.28.92.57, port 4000; Nginx on .56 proxies `/api` to it.
  - **Postgres:** Docker on **172.28.92.60**, port **5432**.
- **SSO:** Working: bridge URL uses proxy (172.28.92.56:3011), so the browser no longer hits .57:4000 directly.
- **First user:** Register with e.g. admin@example.com (domain example.com is seeded); first user becomes Admin. Add more domains in Admin → Domains.

---

## 4. Key paths and references

| What | Where |
|------|--------|
| Deployment (no Docker) | [Docs/DEPLOYMENT-ALICLOUD.md](DEPLOYMENT-ALICLOUD.md) |
| Deployment (Docker) | [Docs/DEPLOYMENT-ALICLOUD-DOCKER.md](DEPLOYMENT-ALICLOUD-DOCKER.md) |
| API proxy (Option 2) | [Docs/DEPLOYMENT-OPTION2-API-PROXY.md](DEPLOYMENT-OPTION2-API-PROXY.md) |
| Pentest report | [Docs/PENTEST-REPORT.md](PENTEST-REPORT.md) |
| Backend .env parse fix | [Docs/FIX-BACKEND-ENV.md](FIX-BACKEND-ENV.md) |
| Deploy configs | **deploy/** (docker-compose.*.yml, nginx-*, env.*.example) |
| Migrations | Backend/src/db/migrations/ (001–005); run via `npm run migrate` or on server start |

---

## 5. Servers (staging)

| Server | Role | Ports (relevant) | Notes |
|--------|------|-------------------|--------|
| **172.28.92.56** | Frontend + Nginx proxy | 3010 (public), 3100 (container) | Clone in /opt/downstream-hub; Docker frontend + host Nginx. |
| **172.28.92.57** | Backend API | 4000 (API) | Clone in /opt/downstream-hub; docker-compose.backend.yml; DATABASE_URL → `.60`. |
| **172.28.92.60** | PostgreSQL | 5432 | Clone in /opt/downstream-hub; docker-compose.db.yml; repo root `.env`. |

---

## 6. When you resume

1. **Read this file** and, if needed, [DEPLOYMENT-OPTION2-API-PROXY.md](DEPLOYMENT-OPTION2-API-PROXY.md) and [DEPLOYMENT-ALICLOUD-DOCKER.md](DEPLOYMENT-ALICLOUD-DOCKER.md).
2. **Check staging:** Open http://172.28.92.56:3011; log in; try SSO. If something is down, SSH to the right server and run `docker ps` and `docker compose -f deploy/docker-compose.*.yml ps`.
3. **Open items (from pentest):** Security headers (P-11), dependency audit (P-12), lockout tests re-enabled (P-13), HTTPS in production (P-14). See [PENTEST-REPORT.md](PENTEST-REPORT.md) §5.
4. **Codebase:** Main app in **Backend/** and **Frontend/**; deploy assets in **deploy/**; docs in **Docs/**.

---

## 7. Document history

| Date | Change |
|------|--------|
| Mar 2026 | Initial project resume summary (rate limiting, deployment, Option 2 proxy, SSO fix, .env fix, pgAdmin). |
