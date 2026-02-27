# Password Expiry — Implementation Plan

This plan adds **password expiry** (e.g. “passwords must be changed every 90 days”) and an **Admin sub-menu** to manage the policy. When a user’s password is expired, login is blocked until they change it.

---

## Overview

| Item | Description |
|------|-------------|
| **Policy** | Admin sets “Password expires after X days” (0 = disabled). Stored in DB so Admins can change it without redeploy. |
| **Per user** | Each user has `password_changed_at`. If policy is enabled and `password_changed_at + X days` is in the past, login returns “Password expired” and user must change password. |
| **Admin UI** | New section **Password policy** (or **Security**) under Admin: view/edit “Password expires after … days” (0 = never). |
| **Change password** | Authenticated users can change password (current + new + confirm). Expired users get a dedicated “Change your password” flow after failed login. |

---

## Phase 1 — Schema & policy storage

### 1.1 Migration: `password_changed_at` on users

- Add column to `users`:
  - `password_changed_at TIMESTAMPTZ NULL`
- Backfill existing users:
  - Set `password_changed_at = created_at` (expiry from account creation), **or**
  - Set `password_changed_at = now()` (give everyone a fresh period from go-live).
- On **register**, set `password_changed_at = now()` (already implied if we set default in migration for new rows; otherwise set in app on insert).
- **New file:** `backend/src/db/migrations/004_password_expiry.sql`.

### 1.2 Migration: password policy table

- Create table `password_policy` (single row):
  - `id` (e.g. PK, or single row with `id = 1`)
  - `password_expiry_days INT NOT NULL DEFAULT 0`  
  - `0` = expiry disabled; `> 0` = password must be changed within this many days of `password_changed_at`.
- Insert one row: `password_expiry_days = 0` (disabled by default).
- **Same file:** `004_password_expiry.sql` can add both users column and this table.

### 1.3 Data access

- **usersDb:**  
  - In `create()`, set `password_changed_at` in INSERT (e.g. `now()`).  
  - Add `updatePassword(db, userId, password_hash)` that updates `password_hash` and sets `password_changed_at = now()`.  
  - `getByEmail` (and any login path) must return `password_changed_at` so auth can check expiry.
- **New:** `backend/src/db/passwordPolicyDb.js` (or `settingsDb.js`):  
  - `get(db)` → `{ password_expiry_days }`.  
  - `update(db, { password_expiry_days })` → update the single row; validate `>= 0`.

---

## Phase 2 — Auth: enforce expiry & change password

### 2.1 Login: check password expiry

- After successful email + password check:
  1. Load policy: `password_expiry_days = passwordPolicyDb.get(pool).password_expiry_days`.
  2. If `password_expiry_days === 0`, skip expiry check (current behaviour).
  3. If `password_expiry_days > 0` and user has `password_changed_at`:
     - If `password_changed_at + password_expiry_days days < now()` → **password expired**.
  4. If user has no `password_changed_at` (legacy): treat as expired if policy > 0 (or set to `created_at` in migration and treat same as above).
- When expired:
  - **Do not** issue a session token.
  - Return **403** with body e.g. `{ error: "Password expired", code: "PASSWORD_EXPIRED" }` so the frontend can redirect to a “Change password” page that only needs email + current password + new password (no token yet).

### 2.2 Change password (unauthenticated — for expired users)

- **POST /api/auth/change-password-expired**  
  - Body: `{ email, current_password, new_password, new_password_retype }`.  
  - Validate email + current_password (same as login).  
  - If password expired (same logic as 2.1), allow change: validate new_password length and new_password === new_password_retype, then `usersDb.updatePassword(pool, user.id, hash(new_password))`.  
  - Return 200 and optionally a **token** (so frontend can log them in immediately) or 200 with message “Password updated. Please log in.” and let them use login.

### 2.3 Change password (authenticated — for logged-in users)

- **POST /api/auth/change-password** (requires `authMiddleware`).  
  - Body: `{ current_password, new_password, new_password_retype }`.  
  - Validate current_password against `req.user.id`; validate new_password and match.  
  - Call `usersDb.updatePassword(pool, req.user.id, hash(new_password))`.  
  - Optionally audit log (e.g. “user changed password”).  
  - Return 200.

### 2.4 Register

- Ensure `usersDb.create()` includes `password_changed_at` in the INSERT (e.g. `now()`).

---

## Phase 3 — Admin: password policy API & UI

### 3.1 API (Admin only)

- **GET /api/settings/password-policy**  
  - Auth + `requireAdmin`.  
  - Return `{ password_expiry_days }` from `passwordPolicyDb.get(pool)`.
- **PUT /api/settings/password-policy**  
  - Auth + `requireAdmin`.  
  - Body: `{ password_expiry_days }`. Validate `>= 0` and e.g. `<= 365`.  
  - Update via `passwordPolicyDb.update(pool, { password_expiry_days })`.  
  - Audit log: “Admin updated password policy”.

### 3.2 Routes

- Mount in `server.js`: e.g. `app.use('/api/settings', settingsRoutes)` and in `settingsRoutes` use `requireAdmin` for the password-policy endpoints.

### 3.3 Admin UI

- Add a new section to the Admin sidebar, e.g. **Password policy** (or **Security**), path `/admin/password-policy`.
- Page content:
  - Title: “Password policy”.
  - Description: e.g. “Require users to change their password after a number of days. Set to 0 to disable.”
  - Form: one field “Password expires after [number] days” (number input, min 0, e.g. max 365). “0” = never.
  - Save button → **PUT /api/settings/password-policy**.
- Update `SECTIONS` in `Admin.jsx` to include `{ id: 'password-policy', label: 'Password policy', path: 'password-policy' }` (or “Security” if you prefer).
- Ensure `/admin` redirect stays to `/admin/domains` (or keep as is); new section is just another item in the sidebar.

---

## Phase 4 — Frontend: expired flow & change password

### 4.1 Login: handle PASSWORD_EXPIRED

- On **POST /api/auth/login**, if response is 403 and body has `code === 'PASSWORD_EXPIRED'` (or `error === 'Password expired'`):
  - Do not store token; do not redirect to dashboard.
  - Redirect to a dedicated route, e.g. **/change-password-expired**, passing email (e.g. query param or state) so the form can show email and ask for current password + new password + confirm.
  - That page submits to **POST /api/auth/change-password-expired**; on success, either auto-login (if API returns token) or show “Password updated. Please log in.” and redirect to login.

### 4.2 Page: Change password (expired)

- Route: e.g. `/change-password-expired`.
- Form: Email (read-only or prefilled), Current password, New password, Confirm new password.
  - Submit → **POST /api/auth/change-password-expired**.
  - On success: if API returns token, store and redirect to `/`; else redirect to `/login` with a success message.

### 4.3 Change password (logged-in, optional)

- Optional: add a “Change password” link (e.g. in Dashboard header or a simple Profile/Account page).
  - Form: Current password, New password, Confirm new password.
  - Submit → **POST /api/auth/change-password** with `Authorization: Bearer <token>`.
  - On success: show “Password updated” and stay on same page or redirect.

---

## Phase 5 — Audit & docs

### 5.1 Audit

- Log when an Admin updates password policy (already in 3.1).
- Optionally log when a user changes password (authenticated or expired flow) in `audit_logs` (e.g. action_type “PASSWORD_CHANGE”, target_entity user email, no payload_after for security).

### 5.2 Docs

- Update **README.md** / **technical-architecture.md**: mention password expiry, Admin → Password policy, and change-password flows.
- Update **TESTING.md**: add steps for “Admin sets password expiry”, “Login with expired password”, “Change password (expired)” and “Change password (authenticated)” if implemented.

---

## Suggested order of implementation

1. **Migration** (Phase 1): add `password_changed_at`, backfill, create `password_policy` table and seed row.  
2. **usersDb + passwordPolicyDb** (Phase 1): create/update user with `password_changed_at`; add `updatePassword`; implement get/update for policy.  
3. **Auth** (Phase 2): login expiry check; POST change-password-expired; POST change-password (authenticated).  
4. **Settings API** (Phase 3): GET/PUT password-policy, mount routes, requireAdmin.  
5. **Admin UI** (Phase 3): sidebar + Password policy page.  
6. **Frontend** (Phase 4): login handling for PASSWORD_EXPIRED; /change-password-expired page; optional in-app change password.  
7. **Audit & docs** (Phase 5).

---

## Edge cases

- **Existing users:** Backfill `password_changed_at` as in 1.1 so they are subject to policy from go-live (or give them “fresh” by setting to `now()`).  
- **Policy set to 0:** Expiry check is skipped; no one is forced to change.  
- **First-time enable:** When Admin first sets e.g. 90 days, all users with `password_changed_at` older than 90 days will get “Password expired” on next login.  
- **Register:** New users get `password_changed_at = now()`, so they have full X days until first expiry.

---

## Summary checklist

| # | Task |
|---|------|
| 1 | Migration: `users.password_changed_at`, backfill; table `password_policy` with one row. |
| 2 | usersDb: set `password_changed_at` on create; add `updatePassword`; expose `password_changed_at` in getByEmail. |
| 3 | passwordPolicyDb: get/update `password_expiry_days`. |
| 4 | Login: after password check, if policy > 0 and expired, return 403 + PASSWORD_EXPIRED. |
| 5 | POST /api/auth/change-password-expired (no auth); POST /api/auth/change-password (auth). |
| 6 | GET/PUT /api/settings/password-policy (Admin only); mount under /api/settings. |
| 7 | Admin UI: Password policy section, form to set expiry days. |
| 8 | Frontend: on login 403 PASSWORD_EXPIRED, redirect to /change-password-expired; implement that page and optional in-app change password. |
| 9 | Audit + docs + TESTING.md updates. |

You can implement in the order above and test after each phase (e.g. run migration → test login still works → add expiry check → test expired user → add Admin UI → test policy change).
