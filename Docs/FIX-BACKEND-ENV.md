# Fix Backend .env parse error (unexpected character "#")

The error `unexpected character "#" in variable name "3# Downstream Hub..."` usually means **line 1** of `Backend/.env` has an extra character before `#` (e.g. `3#` instead of `#`), or the file has a BOM/encoding issue. Some parsers then treat the whole line as a variable name.

## Fix on the server (172.28.92.57)

**Option A — Edit in nano and fix line 1**

```bash
nano /opt/downstream-hub/Backend/.env
```

- Go to **line 1**. If it reads `3# Downstream Hub...` or anything other than `# Downstream Hub...`, delete the leading `3` (or any character before `#`) so the line starts with `#` only.
- Ensure **no space or character** is before `#` on comment lines.
- Save: Ctrl+O, Enter, Ctrl+X.

**Option B — Remove a leading "3" from line 1 with sed**

```bash
sed -i '1s/^3#/#/' /opt/downstream-hub/Backend/.env
```

If the problem is a different character, replace `3` in the command (e.g. `1s/^.#/#/` to remove any single leading character from line 1).

**Option C — Use a minimal .env without comment lines**

If the parser doesn’t support comments, create a minimal file (replace values with your real secrets):

```bash
cat > /opt/downstream-hub/Backend/.env << 'EOF'
NODE_ENV=production
PORT=4000
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
SSO_TOKEN_SECRET=your_sso_secret_here
SSO_TOKEN_EXPIRY_SECONDS=60
API_PUBLIC_URL=http://172.28.92.56:3011
TRUST_PROXY=1
EOF
```

(Don’t omit `DATABASE_URL` — set it to `postgresql://hub:password@172.28.92.60:5432/downstream_hub`. Add other vars like JWT_SECRET from your current file before overwriting.)

After fixing, recreate the backend container:

```bash
cd /opt/downstream-hub
docker compose -f deploy/docker-compose.backend.yml up -d --force-recreate backend
```
