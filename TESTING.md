# Downstream Hub — Testing Steps (Phases A–D)

Use this guide to verify all implemented phases. Run the app first (e.g. `start.bat` or `docker compose up`). Frontend: **http://localhost:3000**, API: **http://localhost:4000**.

**Automated tests:** To install dependencies and run the backend integration test suite, see **[docs/RUNNING-AUTOMATED-TESTS.md](docs/RUNNING-AUTOMATED-TESTS.md)**.

---

## Prerequisites

- At least **one allowed domain** exists (e.g. `example.com`). If the DB is fresh, add it via Admin → Domains after registering the first user, or ensure migration/seed adds it.
- For Phase A/B: At least **one Business Unit** is useful (e.g. "Engineering"). Create it in Admin → Business Units if needed.

---

## Phase A — Registration (BU + Confirm Password)

### A.1 Registration options (no auth)

1. Open **http://localhost:4000/api/auth/registration-options** in a browser (or use curl/Postman).
2. **Expected:** JSON with `business_units` array (list of `{ id, name, created_at }`). Can be empty `[]` if no BUs exist.
3. **Expected:** No 401; endpoint is public.

### A.2 Register page — UI

1. Go to **http://localhost:3000/register**.
2. **Expected:** Form has **Email**, **Password**, **Confirm password**, and **Business unit** dropdown.
3. **Expected:** Dropdown shows "— No business unit —" and any BUs from registration-options.
4. **Expected:** Submit is blocked or shows error if Password and Confirm password differ (client-side).

### A.3 Register — password mismatch (backend)

1. Call `POST http://localhost:4000/api/auth/register` with body:
   ```json
   { "email": "test@example.com", "password": "secret123", "password_retype": "different" }
   ```
2. **Expected:** Status **400**, body `{ "error": "Password and confirm password do not match" }`.

### A.4 Register — success with BU

1. Ensure `example.com` (or your domain) is in Allowed Domains and at least one BU exists.
2. On **http://localhost:3000/register**, enter:
   - Email: e.g. `phasea@example.com`
   - Password: e.g. `password123`
   - Confirm password: same as password
   - Business unit: select one (e.g. "Engineering")
3. Submit.
4. **Expected:** Redirect to Dashboard; no error. User is logged in.
5. Optional: Call `GET http://localhost:4000/api/auth/me` with the returned token (or after login). **Expected:** `user` includes `business_unit_id` and `business_unit_name`.

### A.5 Register — success without BU

1. On **http://localhost:3000/register**, use a new email (allowed domain), matching password and confirm password, and **"— No business unit —"**.
2. Submit.
3. **Expected:** Redirect to Dashboard; user created with no BU.

### A.6 Register — invalid BU (backend)

1. Call `POST http://localhost:4000/api/auth/register` with body:
   ```json
   { "email": "x@example.com", "password": "pass123", "password_retype": "pass123", "business_unit_id": "00000000-0000-0000-0000-000000000000" }
   ```
2. **Expected:** Status **400**, body `{ "error": "Invalid business unit" }` (unless that UUID exists as a BU).

---

## Phase B — Session & Dashboard BU Display

### B.1 Login response includes BU

1. Register or use a user **with** a Business Unit.
2. Call `POST http://localhost:4000/api/auth/login` with `{ "email": "...", "password": "..." }`.
3. **Expected:** Response `user` has `business_unit_id` (UUID or null). If user has a BU, it matches.

### B.2 GET /me returns business_unit_name

1. Log in (UI or API) to get a token.
2. Call `GET http://localhost:4000/api/auth/me` with header `Authorization: Bearer <token>`.
3. **Expected:** `user` has `business_unit_id` and `business_unit_name`. If user has a BU, `business_unit_name` is the BU name (e.g. "Engineering").

### B.3 Dashboard header shows BU

1. Log in as a user **with** a Business Unit (e.g. one created in A.4).
2. Go to **http://localhost:3000/** (Dashboard).
3. **Expected:** In the header, next to email, you see **"BU: &lt;name&gt;"** (e.g. "BU: Engineering").
4. Log in as a user **without** a BU (or "— No business unit —" at registration).
5. **Expected:** Header shows email only; no "BU: …" line.

### B.4 Dashboard app list filtered by BU

1. As Admin: create an app with **Target BU** = e.g. "Engineering", and one **Global** (All BUs).
2. Log in as a user in "Engineering".
3. **Expected:** Dashboard shows the Engineering app and the Global app.
4. Log in as a user in a **different** BU (or no BU).
5. **Expected:** Dashboard shows only the Global app, not the Engineering-only app.

---

## Phase C — Admin Console (Applications Section & Sub-routes)

### C.1 /admin redirects to /admin/domains

1. Log in as **Admin**.
2. Go to **http://localhost:3000/admin**.
3. **Expected:** Redirect to **http://localhost:3000/admin/domains**.

### C.2 Sidebar and sub-routes

1. In Admin, **Expected:** Sidebar has **Domains**, **Business Units**, **Users**, **Applications**.
2. Click each; URL should be `/admin/domains`, `/admin/business-units`, `/admin/users`, `/admin/applications`.
3. **Expected:** Active section is highlighted in the sidebar.
4. **Expected:** Direct link **http://localhost:3000/admin/applications** opens Applications section.

### C.3 Applications section title and description

1. Go to **Admin → Applications**.
2. **Expected:** Section title **"Applications"** and a short description mentioning **Target BU** and **All BUs (Global)**, and confirmation before delete.

### C.4 Non-Admin cannot use Admin

1. Log in as **Employee** (non-first user).
2. Open **http://localhost:3000/admin/domains**.
3. **Expected:** Message "Admin access required" (or redirect); no CRUD on domains/BUs/users/applications.

---

## Phase D — SSO Bridge & Audit

### D.1 SSO redirect returns bridge URL

1. Log in; ensure at least one application exists (Admin → Applications).
2. On Dashboard, click an application card (or call `GET http://localhost:4000/api/sso/redirect?applicationId=<app-uuid>` with `Authorization: Bearer <token>`).
3. **Expected:** Response includes `bridgeUrl` pointing to the API (e.g. `http://localhost:4000/api/sso/bridge?ref=...`). **Token is not in the URL** (no `token=` in query).

### D.2 Bridge page POSTs token (not in URL)

1. From D.1, open `bridgeUrl` in a browser (or use the redirect flow).
2. **Expected:** Page shows "Redirecting to application..." and then a form POST to the target app’s URL.
3. **Expected:** In the HTML source (or dev tools), the form has a hidden input **`token`** (or similar) in the **body**, not in the URL. Token must not appear in the address bar.

### D.3 Audit log — Admin CRUD

1. As Admin, perform: create an application, update a Business Unit, add an allowed domain (or similar).
2. In the database, query `audit_logs`:  
   `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;`
3. **Expected:** Rows for CREATE/UPDATE with `actor_id`, `action_type`, `target_entity`, `payload_before` / `payload_after`, `ip_address`.

### D.4 Audit log — Login

1. Log in via UI or `POST /api/auth/login`.
2. Query `audit_logs` for recent rows:  
   `SELECT * FROM audit_logs WHERE action_type = 'LOGIN' ORDER BY created_at DESC LIMIT 1;`
3. **Expected:** At least one LOGIN row with your user and IP.

### D.5 SSO access logs

1. Click an app on the Dashboard to trigger SSO (redirect then bridge).
2. Query:  
   `SELECT * FROM sso_access_logs ORDER BY created_at DESC LIMIT 1;`
3. **Expected:** Row with `user_id`, `application_id`, `outcome` (e.g. 'success').

---

## Quick checklist

| Phase | Key check |
|-------|-----------|
| **A** | Registration has confirm password + BU dropdown; registration-options public; 400 on password mismatch / invalid BU. |
| **B** | Login and /me return business_unit_id and business_unit_name; dashboard header shows "BU: &lt;name&gt;" when set. |
| **C** | /admin → /admin/domains; sidebar with 5 sections (incl. Password policy); Applications has title and description; non-Admin blocked. |
| **D** | SSO bridge URL has no token in query; form POSTs token in body; audit_logs for CRUD and LOGIN; sso_access_logs for SSO. |
| **Password expiry** | Admin → Password policy; set days; login expired → change-password-expired; in-app Change password. |
| **Security policy** | Admin → Security policy: complexity, history, lockout; login 423 when locked; Admin → Users → Unlock; change-password rejects reuse. |

---

## Password expiry (Admin → Password policy)

### E.1 Admin: set password expiry

1. Log in as **Admin**.
2. Go to **Admin → Password policy** (sidebar).
3. **Expected:** Section "Password policy" with description and a number input "Password expires after (days)" (0–365). Default 0 = disabled.
4. Set e.g. **1** (for testing: 1 day) and click **Save**.
5. **Expected:** Value persists; no error. Optional: call `GET /api/settings/password-policy` with Admin token; response has `password_expiry_days: 1`.

### E.2 Login with expired password

1. Ensure policy is **> 0** (e.g. 1 day) and the test user's password was set more than 1 day ago (or backdate `users.password_changed_at` in DB for that user).
2. Log out; go to **Login**, enter that user's email and password, submit.
3. **Expected:** Redirect to **/change-password-expired** (no token); form shows email (prefilled if passed) and fields: Current password, New password, Confirm new password.
4. Enter current password and new password (twice), submit.
5. **Expected:** Password updated; either auto sign-in and redirect to Dashboard, or "Password updated. Please sign in." and redirect to Login.
6. Sign in again with the **new** password. **Expected:** Success.

### E.3 Change password (logged-in)

1. Log in as any user.
2. On Dashboard, click **Change password** (header).
3. **Expected:** Page at `/change-password` with Current password, New password, Confirm.
4. Enter current password and new password (twice), submit.
5. **Expected:** "Password updated successfully." Optional: sign out and sign in with new password to confirm.

### E.4 Policy 0 = no expiry

1. In Admin → Password policy, set **0** and Save.
2. Log in with any user (including one that would have been expired). **Expected:** Login succeeds; no redirect to change-password-expired.

---

## Security policy (complexity, history, lockout)

### F.1 Admin: Security policy section

1. Log in as **Admin** → **Admin** → **Security policy** (or Password policy).
2. **Expected:** Expiry days, **min length**, **complexity** checkboxes (uppercase, lowercase, number, symbol), **password history count**, **max login attempts**, **lockout duration**. Save and confirm values persist (GET /api/settings/password-policy).

### F.2 Complexity: weak password rejected

1. Set min length 8 and require symbol; try to register (or add user) with a password that has no symbol (e.g. `Password1`). **Expected:** 400; error about complexity.
2. Register with a compliant password (e.g. `StrongPass1!`). **Expected:** Success.

### F.3 Lockout and Unlock

1. Set **max login attempts** to 2 and **lockout duration** to e.g. 30 minutes.
2. As a test user, enter wrong password twice. **Expected:** Third attempt (even with correct password) returns **423** / "Account locked" (or equivalent in UI).
3. As **Admin** → **Users**, find that user. **Expected:** Status "Locked" and **Unlock** button. Click **Unlock**.
4. Log in as that user with correct password. **Expected:** 200 / success.

### F.4 Password reuse rejected

1. Set **password history count** to 2. As a user, change password to **A**, then to **B**, then try to change to **A** again. **Expected:** 400 "Cannot reuse a recent password" (or equivalent).

---

## Optional: API-only smoke test

With `curl` or Postman (replace `EXAMPLE.COM` and `PASSWORD` and IDs as needed):

```bash
# Registration options (Phase A)
curl -s http://localhost:4000/api/auth/registration-options

# Register with BU (Phase A) — use real domain from allowed_domains
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass123","password_retype":"pass123","business_unit_id":"<bu-uuid>"}'

# Me (Phase B) — use token from login/register
curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer <token>"

# SSO redirect (Phase D) — requires valid app id and token
curl -s "http://localhost:4000/api/sso/redirect?applicationId=<app-uuid>" -H "Authorization: Bearer <token>"

# Password policy (Admin token)
curl -s http://localhost:4000/api/settings/password-policy -H "Authorization: Bearer <admin-token>"
curl -s -X PUT http://localhost:4000/api/settings/password-policy -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" -d '{"password_expiry_days":90}'
```
