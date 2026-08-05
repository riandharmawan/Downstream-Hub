# Deployment package (Alibaba Cloud, three servers)

| File | Purpose |
|------|--------|
| **env.frontend.example** | Copy to Frontend/.env on 172.28.92.56; set `VITE_API_URL` to backend URL. |
| **env.backend.example** | Copy to Backend/.env on 172.28.92.57; set `DATABASE_URL` (→ `.60`), `JWT_SECRET`, etc. |
| **env.db.example** | Copy to repo root `.env` on 172.28.92.60; set `POSTGRES_*`. |
| **nginx-frontend.conf** | Nginx server block for serving the built SPA on port 3010 (Frontend server). |
| **nginx-frontend-with-api-proxy.conf** | Nginx on `.56` — proxies `/api` and `/uploads` to `.57:4000`. |
| **downstream-hub-backend.service** | systemd unit for the Node.js API (Backend server). |
| **docker-compose.frontend.yml** | Frontend container on host port 3100 (run on 172.28.92.56). Public port 3010 is served by Nginx proxy. |
| **docker-compose.backend.yml** | Backend API container on 4000 (run on 172.28.92.57). Mounts `Backend/uploads`. |
| **docker-compose.db.yml** | PostgreSQL container on 5432 (run on 172.28.92.60). |
| **rebuild-backend-staging.sh** | On backend host: `git pull`, `chown` uploads for UID 1001, rebuild/recreate API container. |
| **rebuild-db-staging.sh** | On DB host: `git pull`, recreate Postgres container. |
| **rebuild-frontend-staging-proxy.sh** | On app host: rebuild frontend with proxy-mode `VITE_API_URL`, deploy, and reload Nginx on 3010. |
| **migrate-db-to-60.sh** | One-time: dump / copy / restore / verify for DB migration from legacy `.57` stack. |
| **cutover-backend-to-60.sh** | One-time: stop backend, set `DATABASE_URL` to `.60`, recreate API container. |
| **setup-db-firewall.sh** | On DB host: allow Postgres from backend `.57` (optional admin IP). |

Full steps: **[Docs/DEPLOYMENT-ALICLOUD.md](../Docs/DEPLOYMENT-ALICLOUD.md)**. For **Docker** on three servers: **[Docs/DEPLOYMENT-ALICLOUD-DOCKER.md](../Docs/DEPLOYMENT-ALICLOUD-DOCKER.md)**. Staging pull/deploy: **[Docs/Guide/STAGING-DEPLOY-TWO-SERVERS.md](../Docs/Guide/STAGING-DEPLOY-TWO-SERVERS.md)**. DB migration: **[Docs/Guide/STAGING-DB-MIGRATION.md](../Docs/Guide/STAGING-DB-MIGRATION.md)**.

**Ports:** Public app **3010** (Nginx on app host), frontend container **3100**, Backend API **4000** on `.57`, PostgreSQL **5432** on `.60`.
