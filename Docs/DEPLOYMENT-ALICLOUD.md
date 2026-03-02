# Downstream Hub — Deployment Guide (Alibaba Cloud, two servers)

This guide covers deploying the application from GitHub to two Alicloud servers: **Frontend** on one host and **Backend + Database** on the other. Install path: **/opt**.

---

## 1. Port assignment

### Ports already in use (do not use)

| Server        | Ports in use                          |
|---------------|----------------------------------------|
| **172.28.92.56** (Frontend) | 22, 80, 3000, 3001, 38849 (127.0.0.1) |
| **172.28.92.57** (Backend)  | 22, 3001, 5001, 5432                  |

### Recommended ports for Downstream Hub

| Service           | Server        | Port  | Notes                                      |
|-------------------|---------------|-------|--------------------------------------------|
| **Frontend (HTTP)** | 172.28.92.56 | **3010** | Nginx serving built SPA; 80/3000/3001 taken |
| **Backend API**   | 172.28.92.57 | **4000** | Node.js API                                |
| **PostgreSQL**    | 172.28.92.57 | **5432** | Use existing instance for app database     |

- **Frontend**: Users open `http://172.28.92.56:3010` (or your domain pointing to this host).
- **Backend**: Frontend calls `http://172.28.92.57:4000` (set via `VITE_API_URL` at build time).
- **Database**: Backend connects to PostgreSQL on 172.28.92.57:5432 via `DATABASE_URL`.

---

## 2. Deployment layout under /opt

Both servers use a single repo clone under `/opt/downstream-hub` with this structure:

```
/opt/downstream-hub/
├── Backend/          # Node.js API (used on 172.28.92.57)
├── Frontend/         # React app (built on 172.28.92.56; Nginx serves dist/)
├── deploy/           # This deployment package (env examples, nginx, systemd)
├── Docs/
└── ...
```

- **172.28.92.56**: Use `Frontend/` and `deploy/`. Optional: keep full repo for consistency.
- **172.28.92.57**: Use `Backend/` and `deploy/`. PostgreSQL can be existing system Postgres or a dedicated instance.

---

## 3. Prerequisites

### Frontend server (172.28.92.56)

- **Node.js** ≥ 20 and **npm**
- **Nginx** (to serve the built frontend on port 3010)
- **Git** (to clone the repo)

### Backend server (172.28.92.57)

- **Node.js** ≥ 20 and **npm**
- **PostgreSQL** (listening on 5432; create DB and user for the app)
- **Git**
- Optional: **Redis** (if you add SSO/session caching later)

---

## 4. Server 172.28.92.56 — Frontend

### 4.1 Clone and install

```bash
sudo mkdir -p /opt/downstream-hub
sudo chown "$USER:$USER" /opt/downstream-hub
cd /opt/downstream-hub
git clone --branch sit https://github.com/riandharmawan/Downstream-Hub.git .
# Or: git clone https://github.com/riandharmawan/Downstream-Hub.git . && git checkout sit
```

### 4.2 Environment (build-time API URL)

The frontend is built with the backend URL baked in. Create a `.env` in the Frontend directory:

```bash
cp deploy/env.frontend.example Frontend/.env
# Edit and set the backend URL (must be reachable from the user's browser if no proxy)
nano Frontend/.env
```

Set:

```env
VITE_API_URL=http://172.28.92.57:4000
```

If users will access the app via a domain or load balancer, use that base URL for the API (e.g. `https://api.yourdomain.com` or `http://172.28.92.57:4000`).

### 4.3 Build

```bash
cd /opt/downstream-hub/Frontend
npm ci
npm run build
```

Output is in `Frontend/dist/`.

### 4.4 Nginx (port 3010)

Install Nginx if needed:

```bash
sudo yum install -y nginx   # Alibaba Cloud Linux / CentOS
# or: sudo apt install -y nginx
```

Copy and enable the config:

```bash
sudo cp /opt/downstream-hub/deploy/nginx-frontend.conf /etc/nginx/conf.d/downstream-hub.conf
# Ensure root in config points to: /opt/downstream-hub/frontend/dist
# If your clone uses "Frontend" (capital F), edit: root /opt/downstream-hub/Frontend/dist;
sudo nginx -t
sudo systemctl reload nginx
```

Open firewall for 3010 if applicable:

```bash
sudo firewall-cmd --permanent --add-port=3010/tcp
sudo firewall-cmd --reload
```

Frontend is available at **http://172.28.92.56:3010**.

---

## 5. Server 172.28.92.57 — Backend and database

### 5.1 PostgreSQL: create database and user

On 172.28.92.57, connect as a superuser and create the app database and user:

```bash
sudo -u postgres psql
```

In `psql`:

```sql
CREATE USER hub WITH PASSWORD 'your_secure_password';
CREATE DATABASE downstream_hub OWNER hub;
GRANT ALL PRIVILEGES ON DATABASE downstream_hub TO hub;
\c downstream_hub
GRANT ALL ON SCHEMA public TO hub;
\q
```

Use the same password in `DATABASE_URL` below.

### 5.2 Clone and install Backend

```bash
sudo mkdir -p /opt/downstream-hub
sudo chown "$USER:$USER" /opt/downstream-hub
cd /opt/downstream-hub
git clone --branch sit https://github.com/riandharmawan/Downstream-Hub.git .
cd Backend
npm ci --omit=dev
```

### 5.3 Backend environment

```bash
cp ../deploy/env.backend.example .env
nano .env
```

Set at least:

- **DATABASE_URL** — `postgresql://hub:your_secure_password@127.0.0.1:5432/downstream_hub`
- **JWT_SECRET** — long random string (production)
- **SSO_TOKEN_SECRET** — long random string (production)
- **API_PUBLIC_URL** — `http://172.28.92.57:4000` (or your public API URL)
- **TRUST_PROXY=1** if behind a reverse proxy

### 5.4 Database migrations

Migrations are in `Backend/src/db/migrations/` (001_initial.sql through 005_security_policy_and_lockout.sql). They are idempotent and run in order.

**Option A — Run migrations once before first start:**

```bash
cd /opt/downstream-hub/Backend
npm run migrate
```

**Option B — Let the API run them on startup:**  
The server runs migrations automatically when `DATABASE_URL` is set (see `Backend/src/server.js`). You can start the app without running `npm run migrate` if you prefer.

### 5.5 Run the API

**Manual (foreground):**

```bash
cd /opt/downstream-hub/Backend
node src/server.js
```

**With systemd (recommended):**

Create a dedicated user (optional but recommended):

```bash
sudo useradd -r -s /bin/false downstream
sudo chown -R downstream:downstream /opt/downstream-hub/Backend
# .env must be readable by 'downstream'
sudo chmod 600 /opt/downstream-hub/Backend/.env
sudo cp /opt/downstream-hub/deploy/downstream-hub-backend.service /etc/systemd/system/
# Edit if paths or user differ
sudo systemctl daemon-reload
sudo systemctl enable downstream-hub-backend
sudo systemctl start downstream-hub-backend
sudo systemctl status downstream-hub-backend
```

Open firewall for 4000 if needed:

```bash
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

API is available at **http://172.28.92.57:4000** (e.g. `GET /health`).

---

## 6. Verification

| Check | How |
|-------|-----|
| Backend health | `curl http://172.28.92.57:4000/health` → `{"status":"ok",...}` |
| Frontend | Open `http://172.28.92.56:3010` in a browser |
| Login/Register | Use an email whose domain is in **allowed_domains** (add via Admin after first login) |

First user to register from an allowed domain becomes Admin. Add allowed domains in Admin → Domains, then register or log in.

---

## 7. Summary: quick reference

| Item | Frontend (172.28.92.56) | Backend (172.28.92.57) |
|------|--------------------------|-------------------------|
| **Port** | 3010 (Nginx) | 4000 (Node), 5432 (PostgreSQL) |
| **Path** | /opt/downstream-hub/Frontend (build → dist) | /opt/downstream-hub/Backend |
| **Env** | Frontend/.env (VITE_API_URL) | Backend/.env (DATABASE_URL, JWT_SECRET, etc.) |
| **Start** | Nginx serves dist/ | `node src/server.js` or systemd |
| **Migrations** | — | `npm run migrate` or on app start |

---

## 8. Optional: Alibaba Cloud KMS (secrets)

To load secrets (e.g. JWT_SECRET, DATABASE_URL) from Alibaba Cloud KMS:

1. Install: `cd Backend && npm install @alicloud/kms20160120`
2. In `.env`: set `USE_SECRET_MANAGER=alicloud`, `ALICLOUD_SECRET_NAME`, `ALICLOUD_REGION`; optionally `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET` (or use ECS RAM role).
3. Store a JSON object in the secret; keys become `process.env` (see `Backend/src/config/loadSecrets.js`).

---

## 9. Document history

| Date | Change |
|------|--------|
| 24 Feb 2026 | Initial deployment guide: two servers, ports 3010/4000/5432, /opt layout, migrations, nginx, systemd. |
