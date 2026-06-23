# SSO / OIDC Debug Handoff — Jetty Planning System (JPS)

**Date:** 2026-06-18 (updated 2026-06-22)  
**Environment:** `172.28.92.56`  
**Hub (public):** `http://172.28.92.56:3010` (Nginx proxy; login at `/login`)  
**Hub container (internal):** `:3100`  
**JPS frontend (nginx):** `:3080`  
**JPS backend (likely):** `:3081`  
**Status:** Hub login and OIDC authorization succeed; JPS callback fails with blank page.

**Integration contract (all apps, including JPS):** [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md) — especially §4 (SSO v2 silent upsert) and §12 (staging URLs).

Use this document when working with the JPS team (or JPS Cursor agent) to fix the **JPS-specific** downstream side of SSO (nginx, callback routing, env alignment).

---

## Symptom

1. User logs into Downstream Hub successfully.
2. User clicks **Jetty Planning System** on the Hub dashboard.
3. Browser is redirected to:

   ```
   http://172.28.92.56:3080/auth/oidc/callback?code=...&state=...&code_verifier=...
   ```

4. Page is **blank** — no UI, no console errors, no visible loading state.

---

## Hub Application Configuration (confirmed)

| Field | Value |
|---|---|
| App name | Jetty Planning System |
| Target URL | `http://172.28.92.56:3080/` |
| SSO Mode | OIDC (strict) |
| OAuth Client ID | `jps-local` |
| OIDC Redirect URI | `http://172.28.92.56:3080/auth/oidc/callback` |

### Hub OIDC endpoints (staging)

All Hub OIDC calls use the public proxy origin — same as every other downstream app:

| Endpoint | URL |
|----------|-----|
| Issuer / `iss` | `http://172.28.92.56:3010` |
| Discovery | `http://172.28.92.56:3010/api/sso/.well-known/openid-configuration` |
| Token | `http://172.28.92.56:3010/api/sso/token` |
| JWKS | `http://172.28.92.56:3010/api/sso/jwks` |

> **Note:** JPS must implement the OIDC consumer flow in [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md). Legacy JWT bridge (`POST /auth/hub`) is not the target path in strict OIDC mode.

---

## Expected OIDC Flow

```
User clicks app in Hub dashboard
        │
        ▼
Hub OIDC authorization (user already logged in)
        │
        ▼
Hub redirects browser to JPS callback:
  GET /auth/oidc/callback?code=...&state=...
        │
        ▼
JPS backend exchanges code for tokens with Hub
        │
        ▼
JPS creates local session, redirects to dashboard
```

The authorization step **is working** — the browser receives a valid `code` in the callback URL. The failure happens **after** redirect, on the JPS side.

---

## Root Cause

**Nginx on port 3080 does not proxy `/auth/*` to the JPS backend.**

| Path on `:3080` | Current behavior | Expected behavior |
|---|---|---|
| `GET /auth/oidc/callback` | Returns SPA `index.html` (763 bytes) | Proxy to JPS backend; backend exchanges code and redirects |
| `GET /auth/oidc/start` | Returns SPA `index.html` | Proxy to JPS backend; backend redirects to Hub authorize URL |
| `GET/POST /api/v1/*` | Proxied to Express backend | Already working |

Because nginx serves the React SPA for `/auth/oidc/callback`, and the SPA has **no React route** for that path, the page renders blank with no errors.

---

## Live Diagnostic Evidence

Commands run against the deployed environment on 2026-06-18:

### 1. Callback returns SPA shell (not backend)

```bash
curl -I "http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test"
```

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 763
Server: nginx/1.29.5
```

Body is the JPS React `index.html`, not a redirect or JSON from the backend.

### 2. API routes reach backend (for comparison)

```bash
curl "http://172.28.92.56:3080/api/v1/auth/oidc/callback?code=test&state=test"
```

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
X-Powered-By: Express
{"error":"Authentication required"}
```

This confirms:
- `/api/v1/*` **is** proxied to the Express backend.
- The backend has OIDC-related routes, but `/auth/oidc/callback` under `/api/v1` returns 401 — likely blocked by auth middleware when it should be public.
- The registered Hub redirect URI is `/auth/oidc/callback` (no `/api/v1` prefix), so the nginx proxy fix is required.

### 3. JPS backend likely on port 3081

```bash
curl -I "http://172.28.92.56:3081/auth/oidc/start"
```

```
HTTP/1.1 307 Temporary Redirect
location: /login?message=please-login
```

Port 3081 responds as an application server (not static nginx). Use this as the upstream for the nginx proxy on 3080.

### 4. JPS frontend bundle analysis

From `http://172.28.92.56:3080/assets/index-*.js`:

- OIDC start URL is built as `${window.location.origin}/auth/oidc/start` (root `/auth/`, not `/api/v1/auth/`).
- React routes include `/login`, `/select-port`, `/`, etc.
- **No** React route for `/auth/oidc/callback` — callback must be handled by the **backend**, not the SPA.

---

## Required Fixes (JPS Team)

### Fix 1 — Nginx: proxy `/auth/` to backend

Add to the nginx config serving port **3080** (adjust upstream if backend port differs):

```nginx
# Auth endpoints must hit JPS backend, not SPA fallback
location /auth/ {
    proxy_pass http://127.0.0.1:3081/auth/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# SPA fallback for all other routes
location / {
    try_files $uri $uri/ /index.html;
}
```

Reload nginx after change:

```bash
sudo nginx -t && sudo nginx -s reload
```

### Fix 2 — Backend: ensure callback route is public

`GET /auth/oidc/callback` must **not** require an existing session. It is the entry point that **creates** the session.

Verify the route:
1. Reads `code` and `state` from query params.
2. Exchanges `code` with Hub token endpoint (using stored or configured `code_verifier` if PKCE is used).
3. Maps Hub user (email / sub) to local JPS user.
4. Creates local session / JWT cookie.
5. Redirects to JPS dashboard (`/` or configured `APP_PUBLIC_ORIGIN`).

If auth middleware wraps all `/auth/*` or `/api/v1/auth/*` routes, exclude `/auth/oidc/callback` and `/auth/oidc/start` from it.

### Fix 3 — Environment alignment

Confirm JPS backend env matches Hub admin settings and [SSO-INTEGRATION-GUIDE.md §12](./SSO-INTEGRATION-GUIDE.md#12-staging-environment-1722892563010):

| Variable | Expected value |
|---|---|
| OIDC client ID | `jps-local` |
| OIDC redirect URI | `http://172.28.92.56:3080/auth/oidc/callback` |
| Hub issuer (`iss`) | `http://172.28.92.56:3010` |
| Hub token URL | `http://172.28.92.56:3010/api/sso/token` |
| Hub JWKS URL | `http://172.28.92.56:3010/api/sso/jwks` |
| Client secret | **None** — public client; PKCE required |

Implement silent upsert and `email_verified` gate per integration guide §4.

---

## Verification Checklist (after JPS fixes)

Run these after nginx reload and backend changes:

```bash
# 1. Callback should NOT return SPA HTML
curl -I "http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test"
# Expect: 302 redirect, 400, or 401 from backend — NOT 200 text/html (763 bytes)

# 2. OIDC start should redirect to Hub (not return SPA)
curl -I "http://172.28.92.56:3080/auth/oidc/start"
# Expect: 302 to Hub authorize URL — NOT 200 text/html
```

Then test end-to-end:
1. Log into Hub at `http://172.28.92.56:3010/login`
2. Click Jetty Planning System on dashboard
3. Should land on JPS dashboard with an active session (not blank callback page)

---

## Secondary Observation — `code_verifier` in callback URL

The live callback URL includes `code_verifier` as a query parameter:

```
/auth/oidc/callback?code=...&state=...&code_verifier=...
```

In standard OAuth2 PKCE, the authorization server returns only `code` and `state`. **Hub intentionally appends `code_verifier`** on dashboard-initiated launches (transitional helper in `Backend/src/routes/sso.js`) so target apps can complete the token exchange without storing the verifier server-side. JPS should read `code_verifier` from the callback query string when present.

---

## Email verification for OIDC SSO (`email_verified` claim)

### Symptom (post-nginx fix)

JPS callback shows:

> Email not verified for SSO. Complete Hub verification (magic link), then try again.

### Cause

JPS reads the OIDC claim `email_verified` from Hub. Hub sets this from `users.email_verified_at`. Password login and admin-created users often have `is_active = true` but `email_verified_at = NULL`, so OIDC emits `email_verified: false` even though Hub login works.

Older Hub builds did **not** auto-send a magic link when this happened.

### Intended flow (Hub fix in this repo)

1. User clicks an app on the Hub dashboard while `email_verified_at` is null.
2. Hub `GET /api/sso/redirect` sends a **magic-link sign-in email** and returns `403 EMAIL_VERIFICATION_REQUIRED`.
3. User opens the link (`/magic-link?token=...`) — verifies email and signs in.
4. User clicks the app again — OIDC token includes `email_verified: true` — JPS allows access.

Alternative: Hub login page → enter email → **Email me a magic link** → open link (same result).

### SMTP not configured?

If Hub SMTP is not set up, the link is logged to the backend console only:

```
[mailer] SMTP not configured; magic link (dev only):
http://...
```

Check logs: `docker logs downstream-hub-api 2>&1 | findstr /i "mailer magic"`

### Deployed Hub with OIDC (strict)

Ensure the OIDC provider derives `email_verified` from `email_verified_at`. The `/api/sso/redirect` gate is in this repo; the OIDC authorize endpoint on deployed Hub may need the same check.

---

## Cursor Handoff Prompt (paste into JPS repo)

```text
Fix Downstream Hub OIDC SSO callback for Jetty Planning System.

Context:
- Hub login: http://172.28.92.56:3010/login
- Hub OIDC issuer: http://172.28.92.56:3010
- Hub redirects to GET http://172.28.92.56:3080/auth/oidc/callback?code=...&state=...&code_verifier=...
- Page is blank because nginx on :3080 serves SPA index.html for /auth/* instead of proxying to backend.
- JPS backend likely runs on :3081. /api/v1/* is already proxied correctly.
- Follow SSO-INTEGRATION-GUIDE.md (§4 silent upsert, §12 staging URLs).

Tasks:
1) Update nginx on port 3080 to proxy location /auth/ to the JPS backend (e.g. http://127.0.0.1:3081/auth/).
2) Ensure GET /auth/oidc/callback is a public backend route (no session required) that:
   - exchanges authorization code with Hub token endpoint
   - maps user by email
   - creates local session
   - redirects to dashboard
3) Ensure GET /auth/oidc/start redirects to Hub OIDC authorize URL.
4) Exclude /auth/oidc/callback and /auth/oidc/start from auth middleware.
5) Verify env: issuer=http://172.28.92.56:3010, client_id=jps-local, redirect_uri=http://172.28.92.56:3080/auth/oidc/callback, no client secret (PKCE).
6) Read code_verifier from callback query when Hub sends it; exchange at http://172.28.92.56:3010/api/sso/token.
7) Enforce email_verified per integration guide §4.

Validation:
- curl -I http://172.28.92.56:3080/auth/oidc/callback?code=test&state=test must NOT return SPA HTML (763 bytes).
- End-to-end: Hub dashboard click → JPS dashboard with session.
```

---

## Related Hub Documentation

- [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md) — **Primary integration contract** (OIDC strict mode, SSO v2, staging §12)
- [SSO v2 – Centralized Verification.md](./SSO%20v2%20%E2%80%93%20Centralized%20Verification.md) — Product/strategy background (rules are in integration guide §4)
- [TEST-PLAN.md](./TEST-PLAN.md) — Hub-side SSO test cases
- [Guide/STAGING-PROXY-SERVER-CONFIG.md](./Guide/STAGING-PROXY-SERVER-CONFIG.md) — Hub operator staging proxy setup
