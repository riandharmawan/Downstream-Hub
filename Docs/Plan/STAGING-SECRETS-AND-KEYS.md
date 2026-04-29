# Staging (and production) secrets — without committing `.env` or keys

**Purpose:** Explain how Downstream Hub is configured on a server when `Backend/.env` and `Backend/keys/` are **not** in the repository (they are gitignored for safety).

**Related files:** `docker-compose.yml`, `deploy/env.backend.example`, `Backend/src/lib/ssoKeyStore.js`, `Docs/REBUILD-RESTART-APPS-DOCKER.md`.

---

## 1. Why they are not in Git

| Artifact | Risk if committed |
|----------|-------------------|
| `Backend/.env` | Database URLs, `JWT_SECRET`, SMTP, SSO secrets, public URLs — trivial to leak from history or forks. |
| `Backend/keys/` (or any PEM on disk) | Private signing keys let an attacker mint valid federation tokens. |

The repository keeps **templates only** (for example `deploy/env.backend.example`, root `.env.example`). Real values live **on the host** or in a **secret manager**.

---

## 2. What the app actually needs

### 2.1 Environment variables

Compose loads the backend from **two** env files (see `docker-compose.yml`):

1. Repo-root `.env` (ports, `VITE_API_URL`, shared DB/redis names, etc.)
2. `Backend/.env` (backend-specific secrets and URLs)

On staging, you **create** these files on the server after `git pull`. They never need to exist in Git.

### 2.2 SSO signing keys (asymmetric)

`Backend/src/lib/ssoKeyStore.js` loads keys in this order:

1. **`SSO_PRIVATE_KEY_PEM`** and **`SSO_PUBLIC_KEY_PEM`** — PEM strings (newlines can be escaped as `\n` in `.env`).
2. If PEM env vars are empty, **`SSO_PRIVATE_KEY_PATH`** and **`SSO_PUBLIC_KEY_PATH`** — filesystem paths **inside the container** (or readable from the mounted volume).

If **`SSO_ENFORCE_STRICT=1`** (or equivalent strict SSO flags in your deployment), missing asymmetric keys causes startup failure — by design.

You do **not** need a `Backend/keys/` folder in the repo. You can either:

- put PEMs only in `Backend/.env` as `SSO_*_PEM`, or  
- store PEM files on the server and mount them, then set `SSO_*_PATH` to the mount path inside the container.

---

## 3. Recommended staging pattern (simple)

### 3.1 One-time server setup

1. Create a directory owned by the deploy user, **outside** the git clone (example):  
   `/opt/downstream-hub/secrets/`
2. Place **`Backend/.env`** there or symlink:  
   `ln -s /opt/downstream-hub/secrets/backend.env /path/to/clone/Backend/.env`  
   (or keep `Backend/.env` directly under the clone but add that path to backups and **exclude from rsync** to dev machines.)
3. Optionally place PEM files under `/opt/downstream-hub/secrets/sso/` with restrictive permissions:

   ```bash
   chmod 700 /opt/downstream-hub/secrets/sso
   chmod 600 /opt/downstream-hub/secrets/sso/private.pem
   chmod 644 /opt/downstream-hub/secrets/sso/public.pem
   ```

4. In `Backend/.env`, set `SSO_ISSUER` and `API_PUBLIC_URL` to the **same host and scheme** your browsers and downstream apps will use (no `localhost` on staging unless every client is on the same machine). See integrator docs: `Docs/SSO-INTEGRATION-GUIDE.md`.

### 3.2 Docker Compose: mount keys (optional)

If you use `SSO_PRIVATE_KEY_PATH` / `SSO_PUBLIC_KEY_PATH`, add a **read-only** volume on the **staging host only** (prefer a `docker-compose.override.yml` that is itself gitignored, or a documented server path):

```yaml
services:
  backend:
    volumes:
      - /opt/downstream-hub/secrets/sso:/run/sso-keys:ro
```

Then in `Backend/.env`:

```env
SSO_PRIVATE_KEY_PATH=/run/sso-keys/private.pem
SSO_PUBLIC_KEY_PATH=/run/sso-keys/public.pem
```

The default `docker-compose.yml` already mounts `./Backend/uploads` for icons; SSO keys are independent unless you choose to colocate them under the clone.

### 3.3 Deploy loop

1. `git pull` on branch (e.g. `sit`).
2. Ensure `Backend/.env` and any PEM mounts still exist (secrets are **not** updated by Git).
3. Rebuild/restart as in `Docs/REBUILD-RESTART-APPS-DOCKER.md`.

---

## 4. Alternative: CI/CD and secret managers

| Approach | When to use |
|----------|-------------|
| **GitHub Actions (or similar) secrets** | Inject env at deploy time; avoid writing PEM to disk if your runner supports ephemeral env-only deploys. |
| **Cloud / Vault secret** | Multiple environments, rotation, audit; app or sidecar loads at startup. |
| **Docker secrets** (Swarm) | If you standardize on Swarm; Compose “secrets” file mode is also possible with care. |

The codebase may already hint at optional paths (see commented `USE_SECRET_MANAGER` in `deploy/env.backend.example`). Prefer one mechanism per environment and document it for operators.

---

## 5. Checklist before calling staging “ready”

- [ ] `JWT_SECRET`, `SSO_TOKEN_SECRET` (if still used for legacy paths), and DB credentials are strong and unique to staging.
- [ ] `SSO_ISSUER` and `API_PUBLIC_URL` match the URL clients use to reach the API.
- [ ] OIDC redirect URIs registered for each application match staging URLs (Admin UI / DB).
- [ ] Asymmetric keys present (`PEM` or `*_PATH`) when strict SSO is on.
- [ ] SMTP and other third-party credentials set in `Backend/.env` only on the server.
- [ ] File permissions on secret paths are minimal (no world-readable private keys).

---

## 6. Key rotation (high level)

1. Generate a new key pair; add the new public JWK with a **new `SSO_KID`** (or multi-key JWKS policy if you extend the store).
2. Update private key on the server; restart backend.
3. Keep old public key in JWKS until all issued tokens have expired and all partners have refreshed JWKS cache — exact steps depend on your `kid` rotation design.

---

**Summary:** Git holds **examples**; the staging server holds **real** `Backend/.env` and key material via files or env vars. Use mounts + `SSO_*_PATH` or inline `SSO_*_PEM`, and never commit those artifacts.
