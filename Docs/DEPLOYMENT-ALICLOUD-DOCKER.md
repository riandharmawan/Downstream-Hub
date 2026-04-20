# Downstream Hub — Deployment Guide (Alibaba Cloud, Docker, two servers)

This guide deploys the application **using Docker** on two Alicloud servers: **Frontend** on one host and **Backend + PostgreSQL** on the other. Install path: **/opt**.

For a non-Docker (host Node/Nginx/PostgreSQL) deployment, see **[DEPLOYMENT-ALICLOUD.md](DEPLOYMENT-ALICLOUD.md)**.

---

## 1. Port assignment

Same as the non-Docker guide:

| Service           | Server        | Port  | Notes                                      |
|-------------------|---------------|-------|--------------------------------------------|
| **Frontend (HTTP)** | 172.28.92.56 | **3010** | Container exposes 3000; host maps 3010→3000 |
| **Backend API**   | 172.28.92.57 | **4000** | Node.js API in container                   |
| **PostgreSQL**    | 172.28.92.57 | **5432** | Postgres container (or use host Postgres)  |

- **Frontend**: Users open `http://172.28.92.56:3010`.
- **Backend**: Frontend calls `http://172.28.92.57:4000` (set at **build time** via `VITE_API_URL`).

---

## 2. Deployment layout under /opt

Clone the full repo on **both** servers (or at least the parts needed to build the images):

```
/opt/downstream-hub/
├── Backend/           # Backend Dockerfile and source
├── Frontend/          # Frontend Dockerfile and source
├── deploy/            # docker-compose.frontend.yml, docker-compose.backend.yml, env examples
├── Docs/
└── ...
```

- **172.28.92.56**: Run frontend stack only (build + run frontend container).
- **172.28.92.57**: Run backend stack (PostgreSQL + Backend API containers).

---

## 3. Prerequisites

### Both servers

- **Docker** (Engine 20.10+)
- **Docker Compose** (v2 or later; `docker compose` or `docker-compose`)
- **Git** (to clone the repo)

### Optional on 172.28.92.57

- If you prefer **host PostgreSQL** instead of a container, install Postgres on the host and use `DATABASE_URL` pointing to it; then run only the backend container (see §5.4).

---

## 4. Server 172.28.92.56 — Frontend (Docker)

### 4.1 Clone repository

**If `/opt/downstream-hub` is empty** (first time):

```bash
sudo mkdir -p /opt/downstream-hub
sudo chown "$USER:$USER" /opt/downstream-hub
cd /opt/downstream-hub
git clone --branch sit https://github.com/riandharmawan/Downstream-Hub.git .
```

**If `/opt/downstream-hub` already exists** (e.g. you get "destination path '.' already exists and is not an empty directory"):

```bash
cd /opt/downstream-hub
git fetch origin
git checkout sit
git pull origin sit
```

Then confirm the deploy folder exists: `ls deploy/` (you should see `docker-compose.frontend.yml`).

### 4.2 Build and run (port 3010)

The frontend image is built with the backend API URL at **build time**. Default in the compose file is `http://172.28.92.57:4000`. To override, set build arg when running:

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.frontend.yml build --build-arg VITE_API_URL=http://172.28.92.57:4000
docker compose -f deploy/docker-compose.frontend.yml up -d
```

Or edit `deploy/docker-compose.frontend.yml` and change the `args.VITE_API_URL` value, then:

```bash
docker compose -f deploy/docker-compose.frontend.yml up -d --build
```

### 4.3 Firewall

```bash
sudo firewall-cmd --permanent --add-port=3010/tcp
sudo firewall-cmd --reload
```

### 4.4 Useful commands

```bash
# Logs
docker compose -f deploy/docker-compose.frontend.yml logs -f

# Stop
docker compose -f deploy/docker-compose.frontend.yml down
```

Frontend is available at **http://172.28.92.56:3010**.

### 4.5 Verify frontend before proceeding to Step 5

Run these checks on **172.28.92.56** (or from your laptop if you can reach that IP) to confirm the frontend is deployed correctly before deploying the backend.

| Check | Command / action | Expected result |
|-------|-------------------|------------------|
| **1. Container running** | `docker ps` (or `docker compose -f deploy/docker-compose.frontend.yml ps`) | Container `downstream-hub-web` is **Up**. |
| **2. Port listening** | `ss -tlnp \| grep 3010` or `netstat -tlnp \| grep 3010` | Something is listening on **3010**. |
| **3. Local HTTP response** | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3010` | **200**. |
| **4. Page content** | `curl -s http://127.0.0.1:3010 \| head -20` | HTML with `<html>`, `<script>`, or React root (e.g. `id="root"`). |
| **5. Browser** | Open `http://172.28.92.56:3010` in a browser (from a machine that can reach the server). | Login/Register page loads. API calls will fail until the backend is up (Step 5); that is expected. |

If all of the above pass, the frontend is deployed correctly. You can proceed to **Step 5** (Backend + PostgreSQL on 172.28.92.57).

---

## 5. Server 172.28.92.57 — Backend + PostgreSQL (Docker)

### 5.1 Clone repository

```bash
sudo mkdir -p /opt/downstream-hub
sudo chown "$USER:$USER" /opt/downstream-hub
cd /opt/downstream-hub
git clone --branch sit https://github.com/riandharmawan/Downstream-Hub.git .
```

### 5.2 Backend environment file

Create the file that the **backend container** will read (secrets and API URL). The **database** URL is set by the compose file, so you do not put it in this file.

**1. Copy the example and open it:**

```bash
cd /opt/downstream-hub
cp deploy/env.backend.example Backend/.env
nano Backend/.env
```

**2. Edit these four values** (replace the placeholders with your own):

| Variable | What to put | Example |
|---------|-------------|---------|
| **JWT_SECRET** | A long random string (used to sign login tokens). Generate one, e.g. `openssl rand -base64 32` | `a1b2c3d4e5...` (many characters) |
| **SSO_TOKEN_SECRET** | Another long random string (used for SSO token encryption). | Same idea as above |
| **API_PUBLIC_URL** | The URL where the API is reachable (for SSO redirects). | `http://172.28.92.57:4000` |
| **TRUST_PROXY** | Leave as `1` when behind a proxy or load balancer. | `1` |

**3. Remove or comment out `DATABASE_URL`** in `Backend/.env` for this Docker setup. The compose file injects `DATABASE_URL` automatically so the backend connects to the Postgres container. If `DATABASE_URL` is present in `Backend/.env`, the compose file’s value still overrides it; removing it avoids confusion.

Save and exit (`Ctrl+O`, Enter, `Ctrl+X` in nano).

### 5.3 PostgreSQL env (for compose)

The Postgres container reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` from the **host** environment or from a `.env` file in the **repo root** when you run `docker compose`.

Create `/opt/downstream-hub/.env` (repo root) with:

```env
POSTGRES_USER=hub
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=downstream_hub
```

Use a strong password. The backend container will connect to Postgres using these same values (compose sets `DATABASE_URL` from them).

### 5.4 Build and run

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.backend.yml up -d --build
```

Migrations run automatically when the backend container starts (see `Backend/src/server.js`).

### 5.5 Firewall

```bash
sudo firewall-cmd --permanent --add-port=4000/tcp
# Optional: if you need external access to Postgres
# sudo firewall-cmd --permanent --add-port=5432/tcp
sudo firewall-cmd --reload
```

### 5.5a Verify database (optional)

To confirm the Postgres container and app database are set up correctly, on **172.28.92.57** run:

```bash
# 1. Postgres container is running
docker ps | grep downstream-hub-db

# 2. Connect into the Postgres container and check DB + tables
docker exec -it downstream-hub-db psql -U hub -d downstream_hub -c "\dt"
```

You should see tables such as `users`, `allowed_domains`, `business_units`, `applications`, `audit_logs`, `password_policy`, etc. If migrations ran on backend startup, these exist. To check allowed domains:

```bash
docker exec -it downstream-hub-db psql -U hub -d downstream_hub -c "SELECT domain FROM allowed_domains WHERE deleted_at IS NULL;"
```

You should see at least `example.com` (seeded by migration).

### 5.6 Useful commands

```bash
# Logs (both services)
docker compose -f deploy/docker-compose.backend.yml logs -f

# Backend only
docker compose -f deploy/docker-compose.backend.yml logs -f backend

# Stop
docker compose -f deploy/docker-compose.backend.yml down

# Stop and remove Postgres data volume (destructive)
docker compose -f deploy/docker-compose.backend.yml down -v
```

API is available at **http://172.28.92.57:4000** (e.g. `GET /health`).

---

## 6. Using host PostgreSQL instead of container

If PostgreSQL is already running on 172.28.92.57 (e.g. on port 5432), you can run **only the backend container** and point it at the host DB.

1. Create database and user on the host (as in [DEPLOYMENT-ALICLOUD.md](DEPLOYMENT-ALICLOUD.md) §5.1).
2. In `Backend/.env`, set:
   - `DATABASE_URL=postgresql://hub:your_password@host.docker.internal:5432/downstream_hub`
3. Run the backend with access to the host:
   - Linux: `docker run --add-host=host.docker.internal:host-gateway ...`
   - Or use the host’s LAN IP instead of `host.docker.internal` in `DATABASE_URL`.

Example (no compose, manual run):

```bash
cd /opt/downstream-hub
docker build -f Backend/Dockerfile -t downstream-hub-api .
docker run -d --name downstream-hub-api --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 4000:4000 --env-file Backend/.env \
  -e DATABASE_URL=postgresql://hub:YOUR_PASSWORD@host.docker.internal:5432/downstream_hub \
  downstream-hub-api
```

Then run migrations once (e.g. temporarily run the same image with `npm run migrate` or start the app once so it runs migrations on startup).

---

## 7. Verification

| Check | How |
|-------|-----|
| Backend health | `curl http://172.28.92.57:4000/health` → `{"status":"ok",...}` |
| Frontend | Open `http://172.28.92.56:3010` in a browser |
| Login/Register | Use an email whose domain is in **allowed_domains** (add via Admin after first login) |

---

## 8. Summary: quick reference

| Item | Frontend (172.28.92.56) | Backend (172.28.92.57) |
|------|--------------------------|-------------------------|
| **Port** | 3010 (host) → 3000 (container) | 4000 (API), 5432 (Postgres container) |
| **Compose file** | `deploy/docker-compose.frontend.yml` | `deploy/docker-compose.backend.yml` |
| **Env** | Build arg `VITE_API_URL` in compose | `Backend/.env` + repo root `.env` (POSTGRES_*) |
| **Start** | `docker compose -f deploy/docker-compose.frontend.yml up -d --build` | `docker compose -f deploy/docker-compose.backend.yml up -d --build` |
| **Migrations** | — | Run on backend container startup |

---

## 9. Optional: Alibaba Cloud KMS (secrets)

To load secrets from KMS, the backend image must include the KMS SDK. Add to `Backend/Dockerfile` (runner stage):

```dockerfile
RUN npm install @alicloud/kms20160120
```

Then in `Backend/.env`: set `USE_SECRET_MANAGER=alicloud`, `ALICLOUD_SECRET_NAME`, `ALICLOUD_REGION`, and optionally access keys or use ECS RAM role.

---

## 10. Document history

| Date | Change |
|------|--------|
| 24 Feb 2026 | Initial Docker deployment guide: two servers, compose files in deploy/, ports 3010/4000/5432. |
