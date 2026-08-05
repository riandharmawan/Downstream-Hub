# Staging DB migration — split Postgres to 172.28.92.60

One-time runbook to move PostgreSQL from the legacy co-located stack on **172.28.92.57** to dedicated host **172.28.92.60**, with minimal downtime.

| Phase | Downtime | Where |
|-------|----------|--------|
| A — Prepare dump/restore | None | `.57` → `.60` |
| B — Cutover backend `DATABASE_URL` | ~5 min API | `.57` |
| C — Cleanup old Postgres on `.57` | None | `.57` (after 24–48h stable) |

Helper scripts: `deploy/migrate-db-to-60.sh`, `deploy/setup-db-firewall.sh`.

---

## Prerequisites

- [ ] `172.28.92.60` provisioned with Docker; repo cloned to `/opt/downstream-hub`
- [ ] `deploy/docker-compose.db.yml` running on `.60` (`deploy/env.db.example` → `.env`)
- [ ] Firewall / security group: `.57` → `.60:5432` allowed
- [ ] Same `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` on both hosts

---

## Phase A — Prepare (no downtime)

### A1. Dump on source (172.28.92.57)

```bash
cd /opt/downstream-hub
bash deploy/migrate-db-to-60.sh dump
# Or manually:
# docker exec downstream-hub-db pg_dump -U hub -d downstream_hub -Fc -f /tmp/downstream_hub.dump
# docker cp downstream-hub-db:/tmp/downstream_hub.dump /tmp/downstream_hub.dump
```

### A2. Copy dump to target

From `.57` (or your workstation with SSH to both):

```bash
scp /tmp/downstream_hub.dump root@172.28.92.60:/tmp/
```

### A3. Restore on target (172.28.92.60)

```bash
cd /opt/downstream-hub
bash deploy/migrate-db-to-60.sh restore
bash deploy/migrate-db-to-60.sh verify
```

Expected: tables listed; `users` count matches source.

---

## Phase B — Cutover (~5 min API downtime)

### B1. Stop backend on `.57` (keep legacy Postgres running for rollback)

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.backend.yml stop backend
```

### B2. Update `Backend/.env` on `.57`

```env
DATABASE_URL=postgresql://hub:YOUR_PASSWORD@172.28.92.60:5432/downstream_hub
```

Use the same password as `POSTGRES_PASSWORD` on `.60`.

### B3. Pull updated compose and restart backend only

```bash
git pull origin sit
docker compose -f deploy/docker-compose.backend.yml up -d --build --force-recreate backend
```

### B4. Verify

**On `.57`:**

```bash
curl -s http://127.0.0.1:4000/health
docker compose -f deploy/docker-compose.backend.yml logs backend --tail 50
```

**On `.56`:**

```bash
curl -s http://127.0.0.1:3010/api/sso/jwks
```

**In browser:** log in, open dashboard and admin panel.

---

## Phase C — Cleanup (after 24–48h stable)

Only after confirming `.60` is the sole DB in use:

```bash
# On .57 — stop legacy Postgres if still running from old compose
docker stop downstream-hub-db 2>/dev/null || true
docker rm downstream-hub-db 2>/dev/null || true

# List volumes before removing
docker volume ls | grep postgres

# DESTRUCTIVE — removes old data on .57
docker volume rm deploy_postgres_data   # confirm exact name first
```

Remove port **5434** from `.57` firewall and security group (no longer needed).

---

## Network and firewall

### On 172.28.92.60

```bash
# firewalld (optional script)
ADMIN_IP=203.0.113.10 bash deploy/setup-db-firewall.sh
```

Manual firewalld:

```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=172.28.92.57/32 port protocol=tcp port=5432 accept'
sudo firewall-cmd --reload
```

### Alibaba Cloud security groups

| Instance | Inbound rule |
|----------|--------------|
| **.60** | TCP 5432 from `172.28.92.57/32` (required) |
| **.60** | TCP 5432 from your admin IP (optional, pgAdmin) |
| **.57** | TCP 4000 from `172.28.92.56/32` (unchanged) |
| **.57** | Remove 5434 if previously open |

### pgAdmin

Connect to **172.28.92.60:5432** (not `.57:5434`). Credentials from `/opt/downstream-hub/.env` on `.60`.

---

## Rollback

If cutover fails on `.57`:

1. Stop backend-only container.
2. Point `DATABASE_URL` back to local Docker Postgres (`@postgres:5432`) or restore legacy `deploy/docker-compose.backend.yml` with co-located Postgres from git history.
3. `docker compose -f deploy/docker-compose.backend.yml up -d`
4. Legacy volume on `.57` is intact until Phase C.

---

## Post-migration checklist

- [ ] Backend logs: no DB connection errors; migrations applied
- [ ] `GET /health` → 200 on `.57`
- [ ] `GET /api/sso/jwks` via `.56:3010` → 200
- [ ] Login, MFA/magic link, dashboard, admin work
- [ ] Uploads still work (`Backend/uploads` on `.57`)
- [ ] pgAdmin connects to `.60:5432`
