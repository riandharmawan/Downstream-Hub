# Downstream Hub SSO Integration Guide (For New Applications)

This guide is for any team integrating a new target application with **Downstream Hub**.

It is written so you can hand it to an engineer (or Cursor) and implement quickly with minimal back-and-forth.

---

## 1) What Downstream Hub Sends

When a user clicks your app in Hub:

1. Hub creates a short-lived JWT.
2. Hub opens a bridge page.
3. The bridge page auto-submits an HTML form to your app.

### Delivery contract (must match exactly)

- Method: `POST`
- Content-Type: `application/x-www-form-urlencoded`
- Form field name: `token`
- URL: your configured `target_url` in Hub Admin
  - If `target_url` does not include `/auth/`, Hub appends `/auth/hub`
  - Example:
    - `http://localhost:5173` -> `http://localhost:5173/auth/hub`
    - `http://localhost:3000/auth/hub` -> kept as is

---

## 2) JWT Contract

Hub signs JWT with:

- Algorithm: `HS256`
- Secret: `SSO_TOKEN_SECRET` (shared between Hub and your app)
- Expiry: `SSO_TOKEN_EXPIRY_SECONDS` (default 60s)

### Payload claims

```json
{
  "user_id": "hub-user-uuid",
  "email": "user@company.com",
  "iat": 1713345000,
  "exp": 1713345060
}
```

Minimum required in your app:

- verify signature with shared secret
- enforce expiry (`exp`)
- reject token if missing `email` or `user_id`

---

## 3) Target App Requirements

Your app must implement `POST /auth/hub` (or whatever path is in Hub target URL) and:

1. Read form body field `token`
2. Verify JWT (`HS256`, shared secret)
3. Find local user by email (recommended, case-insensitive)
4. Create local session/cookie/JWT
5. Redirect user to your app home/dashboard

---

## 4) Local Login + SSO Coexistence

SSO should be additive only:

- Keep existing local login unchanged
- Do not overwrite existing password hash during SSO login
- Existing local users must still be able to login directly

---

## 5) Suggested User Mapping Policy

Choose one and document it clearly:

### Option A: Invite-only (safe default)

- If email exists in local DB -> allow SSO
- If email not found -> return 403 with friendly message

### Option B: JIT user creation

- If email not found -> create local user automatically
- Assign default role and minimum access
- Generate random password hash (never expose a plain password)

---

## 6) Node.js Reference Handler (Express + jsonwebtoken)

```js
import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();
const SSO_SECRET = process.env.SSO_TOKEN_SECRET;
const APP_PUBLIC_ORIGIN = process.env.APP_PUBLIC_ORIGIN || 'http://localhost:5173';

router.post('/auth/hub', express.urlencoded({ extended: false }), async (req, res) => {
  const token = req.body?.token;
  if (!token) return res.status(400).send('Missing token');
  if (!SSO_SECRET) return res.status(503).send('SSO not configured');

  let payload;
  try {
    payload = jwt.verify(token, SSO_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).send('Invalid or expired token');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!email || !payload.user_id) {
    return res.status(400).send('Invalid token payload');
  }

  // 1) find user by email
  // 2) optionally create if JIT enabled
  // 3) create your local session/cookie
  // await createSession(res, user.id);

  return res.redirect(302, `${APP_PUBLIC_ORIGIN}/`);
});
```

---

## 7) Reverse Proxy / Frontend Dev Server Note

If your frontend runs on one port (example `5173`) and backend on another (`3000`):

- Hub target can be `http://localhost:5173`
- BUT frontend dev server must proxy `/auth` to backend

Example (Vite):

```js
server: {
  proxy: {
    '/auth': {
      target: 'http://localhost:3000',
      changeOrigin: true
    }
  }
}
```

If this proxy is missing, you will see:

- `Cannot POST /auth/hub`

---

## 8) Hub Admin Setup Checklist (Per App)

In Downstream Hub Admin -> Applications:

1. Name: your app name
2. Target URL:
   - dev (single backend host): `http://localhost:3000`
   - dev (frontend host + proxy): `http://localhost:5173`
   - sit/prod: public URL that accepts `POST /auth/hub`
3. Save and test launch from dashboard

---

## 9) Environment Checklist

### Hub side

- `SSO_TOKEN_SECRET=<shared-secret>`
- `SSO_TOKEN_EXPIRY_SECONDS=60` (or your value)
- `API_PUBLIC_URL=<Hub API public URL>`

### Target app side

- `SSO_TOKEN_SECRET=<same-shared-secret-as-hub>`
- `APP_PUBLIC_ORIGIN=<where user should land after SSO>`
- optional JIT flags if using JIT policy

---

## 10) Quick Validation Commands

Use these to verify route/proxy before full UI testing:

```bash
curl -i -X POST "http://localhost:3000/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"
```

Expected: not 404 (usually 401/400).

```bash
curl -i -X POST "http://localhost:5173/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"
```

Expected: same behavior as backend (proves frontend proxy works).

---

## 11) Common Failures and Fixes

- `Cannot POST /auth/hub`
  - route missing in backend, or old backend process still running
  - or frontend `/auth` proxy missing/not restarted

- `Invalid or expired token`
  - secret mismatch between Hub and target app
  - token expired (clock skew / delay)

- SSO reaches app but user still unauthorized
  - user mapping failed (email not found)
  - role/port/permission assignment missing after mapping

---

## 12) Handoff Prompt for Cursor (Copy/Paste)

Use this in the target app repo:

```text
Implement Downstream Hub SSO consumer endpoint for this app.

Requirements:
1) Add POST /auth/hub that accepts application/x-www-form-urlencoded with field name token.
2) Verify token using HS256 and env SSO_TOKEN_SECRET.
3) Require payload fields user_id and email.
4) Map user by email (case-insensitive). Keep existing local login behavior unchanged.
5) If user not found, return 403 (invite-only policy).
6) Create local session/cookie on success and redirect to APP_PUBLIC_ORIGIN + "/".
7) Do not log raw token or secret.
8) If frontend runs on separate port, add dev proxy for /auth to backend.
9) Add/update docs for env vars and test steps.
```

---

If you want, I can also generate a **language-specific appendix** (Java/Spring, .NET, Python/FastAPI) for your downstream app teams.
