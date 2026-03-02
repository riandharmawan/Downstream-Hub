# Deployment package (Alibaba Cloud, two servers)

| File | Purpose |
|------|--------|
| **env.frontend.example** | Copy to Frontend/.env on 172.28.92.56; set `VITE_API_URL` to backend URL. |
| **env.backend.example** | Copy to Backend/.env on 172.28.92.57; set `DATABASE_URL`, `JWT_SECRET`, etc. |
| **nginx-frontend.conf** | Nginx server block for serving the built SPA on port 3010 (Frontend server). |
| **downstream-hub-backend.service** | systemd unit for the Node.js API (Backend server). |
| **docker-compose.frontend.yml** | Frontend container on port 3010 (run on 172.28.92.56). |
| **docker-compose.backend.yml** | Backend + PostgreSQL containers on 4000 and 5432 (run on 172.28.92.57). |

Full steps: **[Docs/DEPLOYMENT-ALICLOUD.md](../Docs/DEPLOYMENT-ALICLOUD.md)**. For **Docker** on the same two servers: **[Docs/DEPLOYMENT-ALICLOUD-DOCKER.md](../Docs/DEPLOYMENT-ALICLOUD-DOCKER.md)** (uses `deploy/docker-compose.frontend.yml` and `deploy/docker-compose.backend.yml`).

**Ports:** Frontend **3010**, Backend API **4000**, PostgreSQL **5432** (on backend server).
