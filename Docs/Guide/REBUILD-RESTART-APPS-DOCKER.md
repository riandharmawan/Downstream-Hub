# Rebuild and Restart Apps (Docker)

This runbook explains how to rebuild and restart Downstream Hub containers and verify strict SSO runtime behavior.

## Scope

- Backend API container: `downstream-hub-api`
- Frontend container: `downstream-hub-web`
- Compose file: `docker-compose.yml` at repo root

## Prerequisites

- Docker Desktop running
- Repo root terminal at `d:\Cursor\Downstream Hub`
- `.env` and `Backend/.env` contain desired runtime values

## 1) Rebuild and restart backend + frontend

From repo root:

```bash
docker compose up -d --build --force-recreate backend frontend
```

What this does:

- rebuilds backend and frontend images
- recreates both containers
- keeps DB/Redis running and reused

## 2) Check containers are up

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Expected:

- `downstream-hub-api` is `Up` and mapped to `:4000`
- `downstream-hub-web` is `Up` and mapped to `:3100`

## 3) Quick health/runtime checks

### Frontend

```bash
curl -i http://localhost:3100
```

Expected: `200`

### Backend strict SSO check

```bash
curl -i http://localhost:4000/api/sso/bridge
```

Expected in strict mode: `410`

### OIDC metadata

```bash
curl -i http://localhost:4000/api/sso/.well-known/openid-configuration
curl -i http://localhost:4000/api/sso/jwks
```

Expected: `200` for both endpoints.

## 4) If changes are not reflected

1. Confirm you edited the env files used by Docker compose:
   - root `.env`
   - `Backend/.env` (also loaded by compose)
2. Re-run force recreate:
   ```bash
   docker compose up -d --build --force-recreate backend frontend
   ```
3. If still stale, restart only backend:
   ```bash
   docker compose up -d --build --force-recreate backend
   ```
4. Inspect backend logs:
   ```bash
   docker logs --tail 200 downstream-hub-api
   ```

## 5) Strict SSO/OIDC runtime flags (reference)

These should be present in runtime env when strict enforcement is intended:

- `SSO_ENFORCE_STRICT=1`
- `SSO_ENFORCE_OIDC_ONLY=1`
- `SSO_SIGNING_ALG=RS256`
- `SSO_PRIVATE_KEY_PEM` and `SSO_PUBLIC_KEY_PEM` (or path equivalents)
- `SSO_ISSUER=<public api base>`
- `MFA_ENABLED=1`

## 6) Optional: restart full stack

```bash
docker compose up -d --build --force-recreate
```

Use this when you need to refresh DB/Redis dependencies together with app containers.
