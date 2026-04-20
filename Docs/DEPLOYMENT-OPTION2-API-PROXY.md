# Option 2: API via frontend server (Nginx proxy)

Use this when the backend (172.28.92.57:4000) is only allowed from the frontend server (172.28.92.56) in the security group. The browser then talks only to 172.28.92.56; Nginx on that host proxies `/api` to the backend.

**Result:** Users open **http://172.28.92.56:3011** (not 3010). All requests (UI + API) go to 172.28.92.56; Nginx forwards API to 172.28.92.57.

---

## Prerequisites

- SSH access to **172.28.92.56** (frontend server).
- Frontend container already running on 3010 (current setup).
- Port **3011** free on 172.28.92.56 (or pick another port and change it everywhere below).

---

## Step 1 — Install Nginx (if not installed)

SSH to **172.28.92.56** and run:

```bash
# Alibaba Cloud Linux / CentOS / RHEL
sudo yum install -y nginx

# Or Debian/Ubuntu
# sudo apt update && sudo apt install -y nginx
```

Check:

```bash
nginx -v
```

---

## Step 2 — Copy Nginx config and enable it

On **172.28.92.56**:

```bash
cd /opt/downstream-hub
sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf
sudo nginx -t
```

If `nginx -t` says "syntax is ok", reload:

```bash
sudo systemctl reload nginx
```

If Nginx wasn’t running:

```bash
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Step 3 — Open port 3011 (firewall)

On **172.28.92.56**:

```bash
# firewalld
sudo firewall-cmd --permanent --add-port=3011/tcp
sudo firewall-cmd --reload

# Or iptables
sudo iptables -I INPUT -p tcp --dport 3011 -j ACCEPT
```

(If the admin uses a security group, ask them to allow inbound **TCP 3011** to 172.28.92.56 from the right source, e.g. 0.0.0.0/0 or your office IP.)

---

## Step 4 — Rebuild frontend with same-origin API URL

**Why this step:** The frontend is built once; the API base URL is **baked into** the JavaScript at build time (`VITE_API_URL`). Right now it was built with `http://172.28.92.57:4000`, so the browser tries to call the backend directly and gets blocked. We need a **new build** where the API URL is `http://172.28.92.56:3011` so that:

1. The browser sends all requests (page + API) to **172.28.92.56:3011**.
2. Nginx on 172.28.92.56 receives them; for `/api/...` it forwards to 172.28.92.57:4000.

**What to run** on **172.28.92.56**:

```bash
cd /opt/downstream-hub
# Build a new frontend image with API URL = same server (3011)
docker compose -f deploy/docker-compose.frontend.yml build --no-cache --build-arg VITE_API_URL=http://172.28.92.56:3011
# Start the container with the new image (replaces the old one)
docker compose -f deploy/docker-compose.frontend.yml up -d
```

- `build --no-cache --build-arg VITE_API_URL=...` = create a new frontend image where the app calls 172.28.92.56:3011 for the API.
- `up -d` = run the container from that new image so the change takes effect.

---

## Step 5 — Verify

1. **From your PC browser** open: **http://172.28.92.56:3011**
2. Open DevTools → Network: requests should go to `172.28.92.56:3011` (e.g. `/api/auth/registration-options`, `/api/auth/register`). No requests to 172.28.92.57.
3. Register with an email like `admin@example.com` (domain `example.com` is seeded). It should succeed.

---

## Summary

| Before | After |
|--------|--------|
| Browser → 172.28.92.56:3010 (frontend), Browser → 172.28.92.57:4000 (API, blocked for your IP) | Browser → 172.28.92.56:3011 only; Nginx proxies /api to 172.28.92.57:4000 |
| User opens http://172.28.92.56:3010 | User opens **http://172.28.92.56:3011** |

---

## Copy-paste sequence (all steps on 172.28.92.56)

Run these in order (SSH as root or use `sudo` where needed). If the file `deploy/nginx-frontend-with-api-proxy.conf` is not on the server yet, run `git pull origin sit` in `/opt/downstream-hub` first.

```bash
# 0. (If needed) Get latest deploy files
cd /opt/downstream-hub
git pull origin sit

# 1. Install Nginx (if needed)
sudo yum install -y nginx

# 2. Copy config and reload Nginx
cd /opt/downstream-hub
sudo cp deploy/nginx-frontend-with-api-proxy.conf /etc/nginx/conf.d/downstream-hub-proxy.conf
sudo nginx -t && sudo systemctl reload nginx || (sudo systemctl enable nginx; sudo systemctl start nginx)

# 3. Firewall (if using firewalld)
sudo firewall-cmd --permanent --add-port=3011/tcp
sudo firewall-cmd --reload

# 4. Rebuild frontend with same-origin API URL and restart container
docker compose -f deploy/docker-compose.frontend.yml build --no-cache --build-arg VITE_API_URL=http://172.28.92.56:3011
docker compose -f deploy/docker-compose.frontend.yml up -d
```

Then open **http://172.28.92.56:3011** in your browser. If the security group for 172.28.92.56 allows your IP on port 3011 (or 0.0.0.0/0), registration should work.

---

## If you use another port (e.g. 3012)

1. In `deploy/nginx-frontend-with-api-proxy.conf` change `listen 3011` to `listen 3012`.
2. In Step 4 use `VITE_API_URL=http://172.28.92.56:3012`.
3. Open that port in firewall and security group.
4. Users open `http://172.28.92.56:3012`.
