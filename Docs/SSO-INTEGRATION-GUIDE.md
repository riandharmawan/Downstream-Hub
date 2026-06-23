# Downstream Hub SSO Integration Guide (Strict OIDC Mode)

**Start here.** This is the single integration contract for all downstream applications (including Jetty Planning System and any new app).

- **Implement from this document** — OIDC endpoints, PKCE, token validation, app registration, and SSO v2 silent upsert (§4).
- **Background only:** [SSO v2 – Centralized Verification.md](./SSO%20v2%20%E2%80%93%20Centralized%20Verification.md) explains the product strategy; its rules are normative in **§4** below.
- **JPS-specific debugging:** [SSO-OIDC-JPS-DEBUG-HANDOFF.md](./SSO-OIDC-JPS-DEBUG-HANDOFF.md) (nginx blank-page issues, etc.).

Legacy bridge POST (`/api/sso/bridge`) and HS256 shared-secret integration are no longer the target path in strict mode.

---

## 1) Required flow

Downstream Hub acts as OIDC provider:

1. User logs into Hub and clicks your app on the dashboard (Hub-initiated launch).
2. Hub starts authorization code flow with PKCE.
3. Your app receives `code` and `state` on your registered redirect URI. Hub may also append `code_verifier` in the query string (dashboard handoff helper — read it from the callback or from server-side session storage).
4. Your app calls Hub token endpoint to exchange `code` + `code_verifier`.
5. Your app validates returned `id_token` using Hub JWKS.
6. Your app runs silent user upsert (§4), creates a local session, and redirects to app home.

Hub uses a **public OIDC client** model: no client secret; PKCE is required (`token_endpoint_auth_methods_supported: none`).

---

## 2) OIDC endpoints

Use these endpoints from Hub:

- Discovery: `GET /api/sso/.well-known/openid-configuration`
- Authorization: `GET /api/sso/authorize`
- Token: `POST /api/sso/token`
- JWKS: `GET /api/sso/jwks`

Examples:

| Environment | Discovery URL |
|-------------|---------------|
| Local dev | `http://localhost:4000/api/sso/.well-known/openid-configuration` |
| Staging | `http://172.28.92.56:3010/api/sso/.well-known/openid-configuration` |

On staging, all OIDC traffic uses the **same public origin** (`172.28.92.56:3010`). Nginx proxies `/api/` to the backend; downstream apps must **not** call `172.28.92.57:4000` from the browser. See **§12**.

---

## 3) Required token validation

Validate `id_token` with JWKS and enforce:

- `alg` must match provider metadata (currently `RS256`)
- `iss` equals Hub issuer
- `aud` equals your app client id
- `exp` not expired
- `sub` present (primary identity key)
- **`email_verified` (boolean):** if your app implements **SSO v2 silent linking** (see §4), require `email_verified === true` before you auto-bind `sub` to an existing local user by email or before JIT-creating a user from the token. If `email_verified` is `false`, treat the user as not yet cleared for that policy (user may still need to complete Hub magic-link verification).

Recommended claim usage:

- Identity key: `sub` (Hub user UUID, stable)
- Attributes: `email`, `name`
- Trust / linking gate: `email_verified`

`scope` `openid profile email` continues to be used; the Hub includes `email_verified` in the `id_token` payload when applicable (standard OIDC claim).

---

## 4) SSO v2 — Centralized verification and silent account linking

This section is the **developer contract** for the “SSO v2” model: the Hub proves corporate inbox control (magic link); **your application** performs **silent** user resolution so end users do not see separate “link account” screens for normal SSO launches.

### Identity contract (Hub as OIDC provider)

| Claim | Meaning |
| ----- | ------- |
| `sub` | **Hub user id** (UUID). Use this as the stable primary key for the same person across launches. |
| `email` | Primary email on the Hub account. |
| `name` | Display name (may mirror email). |
| `email_verified` | **`true`** only after the user has completed the Hub’s **out-of-band email verification** for SSO (magic link). The Hub sets this when a one-time verification email is consumed (see flows below). **`false`** means the Hub has not recorded that inbox proof yet. |

**Not the same as registration domain policy:** the Hub may restrict **registration** to certain email domains (`allowed_domains`). That is separate from `email_verified`, which asserts **inbox ownership** via magic link, not only “domain looks corporate.”

### When `email_verified` becomes `true` (Hub-side)

Typical Hub flows that set the underlying Hub flag (and therefore `email_verified: true` on the next `id_token`):

- User completes a **magic link** from **Connect SSO** / **Change password** linking flow: e.g. `GET /api/users/sso/verify?token=...`
- **Auto-link** verification: `POST /api/auth/oidc/auto-link/start` then `GET /api/auth/oidc/auto-link/verify?token=...`

Users who **already** had Hub-side OIDC linking completed before this feature may be **backfilled** so their first `id_token` already shows `email_verified: true`.

### Downstream algorithm (silent upsert — implement in **your** app)

Account **binding** for your local user store happens **in the target application**, not in the Hub:

1. **Check 1 — by `sub`:** If a local user row exists with that `sub` (Hub user id), sign them in.
2. **Check 2 — by `email`:** Else if a local user exists with the same **normalized** `email` from the token, **bind** that row: store `sub`, set your app’s notion of SSO identity (e.g. `auth_source = 'sso'`), sign them in. **Only if** your policy allows it — for v2, only when `email_verified === true` (and your domain rules pass; see below).
3. **Check 3 — neither:** **JIT provision** a new local user from `sub` + `email` (+ `name`), with your default role, and sign them in.

This removes friction: no manual “link” UI in the app for the common case, once the Hub has verified the inbox.

### Security requirements (target app)

- **Strict claim check (recommended):** For first-time binding or JIT, reject or defer silent link if `email_verified !== true`.
- **Domain restriction:** Enforce your own allowlist of corporate email domains (e.g. `@yourcompany.com`) when performing email-based match or JIT — the Hub does not enforce your app’s domain rules inside your database.
- **Audit:** Log every automatic link and every JIT create with at least `sub`, timestamp, and outcome.

### Coexistence with Hub “account linking” APIs (§11)

The Hub APIs under **§11** (e.g. connect SSO, admin prelink) manage **`users.oidc_sub` on the Hub** for **Hub ↔ upstream IdP** coexistence and Hub login behavior.

**Downstream apps** should still implement **§4** using **`id_token.sub`** and **`email_verified`** against **your** application’s user table. You do not need to duplicate Hub’s internal `oidc_sub` linking unless your architecture explicitly requires both.

### Optional Hub environment variable (non-production)

For local/staging convenience only, operators may set `OIDC_EMAIL_VERIFIED_TRUST_ALL=1` so the Hub emits `email_verified: true` without the database flag. **Do not use in production.**

---

## 5) App registration required in Hub

Open **Hub Admin → Applications** (staging: `http://172.28.92.56:3010/admin`) and configure each target app:

| Field | Requirement |
|-------|-------------|
| SSO Mode | `oidc` |
| OAuth Client ID | Unique string, e.g. `my-app-staging` |
| OIDC Redirect URIs | One line per exact callback URL (scheme, host, port, path must match) |
| Target URL | Your app's public base URL |

Example (JPS on staging): client id `jps-local`, redirect URI `http://172.28.92.56:3080/auth/oidc/callback`.

If OIDC fields are missing, Hub blocks launch in strict mode.

---

## 6) Code exchange contract

Token endpoint request:

`POST /api/sso/token` JSON body:

```json
{
  "grant_type": "authorization_code",
  "code": "<authorization-code>",
  "redirect_uri": "https://your-app/callback",
  "client_id": "your-client-id",
  "code_verifier": "<pkce-verifier>"
}
```

Token endpoint response:

```json
{
  "token_type": "Bearer",
  "expires_in": 60,
  "id_token": "<jwt>",
  "scope": "openid profile email"
}
```

The `id_token` JWT includes standard claims such as `sub`, `email`, `name`, and `email_verified` (boolean).

---

## 7) Migration checklist for downstream apps

1. Register the app in Hub Admin (§5).
2. Add a **public** OIDC callback route (`redirect_uri`) on your backend — not a React/SPA route.
3. If you use nginx in front of a SPA, proxy `/auth/` (or your callback prefix) to the backend before SPA fallback (see JPS handoff doc).
4. Store and verify PKCE `code_verifier` per login attempt (Hub may pass it on the callback query string).
5. Exchange `code` at Hub token endpoint (§6).
6. Validate `id_token` via Hub JWKS (§3).
7. Implement silent upsert (§4); enforce **`email_verified`** before email-based link or JIT.
8. Remove dependency on legacy `/auth/hub` bridge POST path.

### Target app environment variables (example)

```env
OIDC_ISSUER=http://172.28.92.56:3010
OIDC_CLIENT_ID=my-app-staging
OIDC_REDIRECT_URI=http://172.28.92.56:YOUR_PORT/auth/oidc/callback
# No client secret — public client + PKCE
```

Use discovery to confirm `issuer` and endpoint URLs match your `OIDC_ISSUER`.

---

## 8) Security requirements

- Use HTTPS in SIT/PROD for all redirect and token traffic.
- Do not log raw `code`, `id_token`, or secrets.
- Reject any token failing `iss`/`aud`/`exp` checks.
- Keep `state` and PKCE verifier bound to the same browser session.
- For SSO v2: combine `email_verified`, domain policy, and audit as in §4.

---

## 9) Troubleshooting

- Error: `SSO OIDC-only enforcement is enabled... sso_mode=oidc`
  - Set app `sso_mode` to `oidc` and configure `oauth_client_id` + `oidc_redirect_uris`.

- `invalid_grant` on token exchange
  - Check `redirect_uri`, `client_id`, and `code_verifier` exactly match authorization request.

- Signature validation fails
  - Refresh JWKS and ensure you validate against current `kid`.

- `email_verified` is always `false` in your app
  - User must complete Hub magic-link verification (§4). Check Hub user state and that you are not using `OIDC_EMAIL_VERIFIED_TRUST_ALL` in production.

- Blank page on OIDC callback (SPA app)
  - Nginx is serving `index.html` instead of proxying the callback path to your backend. See [SSO-OIDC-JPS-DEBUG-HANDOFF.md](./SSO-OIDC-JPS-DEBUG-HANDOFF.md).

- Discovery `issuer` or endpoints show wrong host (e.g. `172.28.92.57:4000`)
  - Hub operator must set `SSO_ISSUER` and `API_PUBLIC_URL` to the public URL integrators use (staging: `http://172.28.92.56:3010`).

---

## 10) Quick runtime checks

Local:

```bash
curl -i http://localhost:4000/api/sso/jwks
curl -i http://localhost:4000/api/sso/.well-known/openid-configuration
curl -i http://localhost:4000/api/sso/bridge
```

Staging:

```bash
curl -i http://172.28.92.56:3010/api/sso/jwks
curl -i http://172.28.92.56:3010/api/sso/.well-known/openid-configuration
curl -i http://172.28.92.56:3010/api/sso/bridge
```

If strict mode is active:

- `/api/sso/bridge` returns `410`
- OIDC discovery and JWKS endpoints return `200`

On staging, discovery should report `"issuer": "http://172.28.92.56:3010"` and endpoints under the same host.

---

## 11) Account linking APIs (Hub UX)

The Hub exposes account-linking APIs to support seamless local+SSO coexistence **on the Hub**:

- Self-service:
  - `GET /api/users/me/sso-status`
  - `POST /api/users/me/sso-connect/start`
  - `POST /api/users/me/sso-unlink`
  - `GET /api/users/sso/verify?token=...`
- Admin:
  - `GET /api/users/:id/sso-status`
  - `POST /api/users/:id/sso-link/start`
  - `GET /api/users/:id/sso-events`
  - `POST /api/users/:id/sso-unlink`
Auto-link helper endpoints (email verification perimeter):

- `POST /api/auth/oidc/auto-link/start`
- `GET /api/auth/oidc/auto-link/verify?token=...`

See **§4** for how **target applications** should map **`id_token`** claims to local users (silent upsert), separately from these Hub APIs.

---

## 12) Staging environment (`172.28.92.56:3010`)

Staging uses **proxy mode**: browsers talk to one origin; Nginx on `.56` forwards `/api/` to the backend on `.57:4000`. Integrators and Hub operators must both use the public URL below.

### Hub URLs (integrators)

| Purpose | URL |
|---------|-----|
| Hub login | `http://172.28.92.56:3010/login` |
| Hub dashboard | `http://172.28.92.56:3010/` |
| Hub Admin (register apps) | `http://172.28.92.56:3010/admin` |
| OIDC discovery | `http://172.28.92.56:3010/api/sso/.well-known/openid-configuration` |
| Authorization | `http://172.28.92.56:3010/api/sso/authorize` |
| Token | `http://172.28.92.56:3010/api/sso/token` |
| JWKS | `http://172.28.92.56:3010/api/sso/jwks` |
| Expected `iss` in `id_token` | `http://172.28.92.56:3010` |

### Hub operator requirements

On the backend server, set in `Backend/.env`:

```env
SSO_ISSUER=http://172.28.92.56:3010
API_PUBLIC_URL=http://172.28.92.56:3010
PUBLIC_APP_URL=http://172.28.92.56:3010
```

Rebuild/restart the API after changing these. If discovery shows `172.28.92.57:4000`, downstream token validation will fail `iss` checks.

Frontend must be built with `VITE_API_URL=http://172.28.92.56:3010`. See [Guide/STAGING-PROXY-SERVER-CONFIG.md](./Guide/STAGING-PROXY-SERVER-CONFIG.md).

### End-to-end test

1. Log in at `http://172.28.92.56:3010/login`.
2. Confirm DevTools Network shows API calls to `.56:3010/api/...` (not `.57:4000`).
3. Register your app in Admin (§5) with exact redirect URI(s).
4. Click the app on the dashboard → callback on your app → token exchange → session created.
5. If blocked with email verification, complete Hub magic link (§4), then retry.

### Node.js verification example (staging)

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'http://172.28.92.56:3010';
const CLIENT_ID = process.env.OIDC_CLIENT_ID;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/api/sso/jwks`));

export async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ISSUER,
    audience: CLIENT_ID,
  });
  if (!payload.sub) throw new Error('Missing sub');
  if (payload.email_verified !== true) throw new Error('Email not verified for SSO');
  return payload;
}
```
