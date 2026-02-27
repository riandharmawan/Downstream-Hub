# Moving Secrets to a Secret Manager (e.g. Alibaba Cloud)

When you deploy to **staging or production** (e.g. Alibaba Cloud), you can move sensitive values from `.env` into a **secret manager** so they are not stored in the repo or in plain env files on the server.

---

## 1. Which secrets to move

From `.env`, these are the **sensitive** values that should live in the secret manager in staging/production:

| Env variable | Description | Used by |
|--------------|-------------|---------|
| `DATABASE_URL` | Full PostgreSQL connection string (includes password) | Backend DB pool |
| `JWT_SECRET` | Signing secret for session JWTs | Auth middleware |
| `SSO_TOKEN_SECRET` | Signing secret for SSO tokens to target apps | SSO routes |

Optional (if you use them and consider them secret):

- `API_PUBLIC_URL` — often non-secret; can stay in env.
- Redis password, if any, inside `REDIS_URL`.

**Non-secret** (can stay in `.env` or deployment config): `NODE_ENV`, `PORT`, `API_PORT`, `JWT_EXPIRES_IN`, `SSO_TOKEN_EXPIRY_SECONDS`, `FRONTEND_PORT`, `VITE_API_URL`, etc.

---

## 2. Approach: load at startup and set `process.env`

The app keeps reading `process.env.JWT_SECRET`, `process.env.SSO_TOKEN_SECRET`, `process.env.DATABASE_URL` everywhere. No need to change auth, SSO, or pool code.

- **Before** the server listens, a small **secret loader** runs.
- If configured (e.g. `USE_SECRET_MANAGER=alicloud`), the loader fetches secrets from the secret manager and **sets** `process.env.JWT_SECRET`, `process.env.SSO_TOKEN_SECRET`, `process.env.DATABASE_URL`, etc.
- Then the rest of the app starts as usual; it only sees `process.env`.

So: **one place** (the loader) talks to the secret manager; everything else stays the same.

---

## 3. Alibaba Cloud Secret Manager (KMS)

Alibaba Cloud KMS provides a **Secrets Manager** with a **GetSecretValue** API. You can store:

- **Option A — One secret per value:** Create separate generic secrets, e.g.  
  `downstream-hub-stg/JWT_SECRET`, `downstream-hub-stg/SSO_TOKEN_SECRET`, `downstream-hub-stg/DATABASE_URL`. The loader fetches each by name and sets the matching env var.
- **Option B — One JSON secret:** Create a single generic secret (e.g. `downstream-hub-stg/app-secrets`) whose value is JSON:  
  `{"JWT_SECRET":"...","SSO_TOKEN_SECRET":"...","DATABASE_URL":"..."}`. The loader fetches once, parses, and sets all keys on `process.env`.

**Credentials to call GetSecretValue:**  
Use an **AccessKey pair** (AccessKeyId + AccessKeySecret) with permission to call `kms:GetSecretValue` on the relevant secrets. Prefer storing this pair in **ECS instance RAM role** or your platform’s secret store so it is not in `.env`. If you must use env vars, use something like `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET` only in the deployment environment (never in the repo).

**Region / endpoint:**  
Use the KMS endpoint for your region, e.g. `kms.cn-hangzhou.aliyuncs.com` (see [Alibaba Cloud KMS regions](https://www.alibabacloud.com/help/en/kms/developer-reference/regions-and-endpoints)).

---

## 4. Enabling the loader in the backend

1. **Install the Alibaba Cloud KMS SDK** (only needed when using the secret manager):
   ```bash
   cd backend
   npm install @alicloud/kms20160120
   ```

2. **Configure the loader** with environment variables (set in staging/production only):

   | Variable | Description |
   |----------|-------------|
   | `USE_SECRET_MANAGER` | Set to `alicloud` to enable loading from Alibaba Cloud. Omit or leave empty to use only `.env` (local dev). |
   | `ALICLOUD_SECRET_NAME` | **Option B:** Name of the single generic secret that stores JSON (e.g. `downstream-hub-stg/app-secrets`). |
   | `ALICLOUD_REGION` | KMS region (e.g. `cn-hangzhou`). |
   | `ALICLOUD_ACCESS_KEY_ID` | AccessKey ID for KMS (prefer from RAM role in production). |
   | `ALICLOUD_ACCESS_KEY_SECRET` | AccessKey Secret for KMS (prefer from RAM role). |

   For **Option A** (one secret per env var), the loader can use a naming convention (e.g. prefix `downstream-hub-stg/` + env var name). See `backend/src/config/loadSecrets.js` for the exact variable names and behavior.

3. **Start the server** so the loader runs first:
   - The backend’s entry point (`server.js`) should `require('./config/loadSecrets')` and **await** the loader’s promise before starting the app (e.g. before `app.listen()`). See the loader file for the exact API.

---

## 5. Storing secrets in Alibaba Cloud (one JSON secret)

1. In Alibaba Cloud Console, open **KMS** → **Secrets Manager** and create a **generic** secret.
2. **Secret name:** e.g. `downstream-hub-stg/app-secrets` (or whatever you set in `ALICLOUD_SECRET_NAME`).
3. **Secret value:** JSON with keys = env variable names, for example:
   ```json
   {
     "JWT_SECRET": "your-production-jwt-secret",
     "SSO_TOKEN_SECRET": "your-production-sso-secret",
     "DATABASE_URL": "postgresql://user:password@your-rds-host:5432/downstream_hub"
   }
   ```
4. Grant the RAM user/role used by your app the permission `kms:GetSecretValue` on this secret (and the KMS key if the secret is encrypted by a CMK).

---

## 6. Summary

- **Move:** `JWT_SECRET`, `SSO_TOKEN_SECRET`, `DATABASE_URL` (and optionally other secrets) into Alibaba Cloud Secrets Manager.
- **Do not** put these in `.env` in staging/production; put them only in the secret manager.
- **Loader:** Set `USE_SECRET_MANAGER=alicloud` and the required `ALICLOUD_*` variables; the backend loads secrets at startup and sets `process.env`, so the rest of the app is unchanged.
- **Credentials:** Prefer ECS RAM role (or similar) for `GetSecretValue`; otherwise use AccessKey in deployment env only.

The loader implementation is in **`backend/src/config/loadSecrets.js`**. The server runs `loadSecrets()` after `dotenv.config()`, so any value you set in the secret manager will override the same key from `.env` when the secret manager is enabled.

**Loader env vars (when `USE_SECRET_MANAGER=alicloud`):**

| Variable | Required | Description |
|----------|----------|-------------|
| `ALICLOUD_SECRET_NAME` | Yes | Name of the generic secret in KMS (e.g. `downstream-hub-stg/app-secrets`). |
| `ALICLOUD_REGION` | No | KMS region (default `cn-hangzhou`). |
| `ALICLOUD_ACCESS_KEY_ID` | No* | AccessKey for KMS. *Omit when using ECS RAM role. |
| `ALICLOUD_ACCESS_KEY_SECRET` | No* | AccessKey secret for KMS. *Omit when using ECS RAM role. |

**Optional dependency:** Only when using Alibaba Cloud secret manager, install in the backend:

```bash
cd backend && npm install @alicloud/kms20160120
```
