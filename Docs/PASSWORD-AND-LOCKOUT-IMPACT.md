# Change Impact: Password Complexity, Reuse (Last 5), and Account Lockout

This document assesses the impact of adding three requirements:

1. **Password length and complexity:** Minimum 6 characters, with a mix of uppercase, lowercase, numbers, and symbols.
2. **Password reuse prohibited:** Users cannot reuse the last **5** passwords.
3. **Account lockout:** Lock after **5** failed login attempts; unlock after **30 minutes** OR when an admin unlocks the account.

Use this to decide if you’re okay with the scope before writing the PRD and tech spec.

---

## 1. Requirement summary

| Requirement | Behaviour |
|-------------|-----------|
| **Complexity** | Min 6 chars; at least one of: uppercase, lowercase, digit, symbol. Validated on register, change-password, change-password-expired, and admin “create user”. |
| **Reuse** | When changing password, new password must not match current or any of the last 5. Configurable via policy (e.g. 0 = off, 5 = your requirement). |
| **Lockout** | On each failed login (wrong password for an existing user): increment failed attempts; if attempts ≥ 5, set lock until “now + 30 min”. On successful login: reset attempts and lock. Login returns 423 Locked (with message and optional `locked_until`) when account is locked; frontend shows “Account locked” and “try again after X” or “contact admin”. Admin can unlock (reset attempts and clear lock). |

---

## 2. Impact overview

| Area | Complexity | Reuse (last 5) | Lockout |
|------|------------|----------------|---------|
| **Database** | Policy columns or rules | New table + policy column | New columns on `users` |
| **Backend – data** | Policy + shared validator | History DB + policy | usersDb + unlock |
| **Backend – auth** | Validate on all set-password flows | Check history before update; add to history after | Login: check lock, increment/reset, set lock |
| **Backend – admin** | Manual create validates | — | New unlock endpoint + Users UI |
| **Frontend** | Policy UI + validation + messages | Policy UI + error message | Login: locked message; Admin: Unlock |
| **Tests & docs** | New cases | New cases | New cases |

---

## 3. Database impact

### 3.1 New migration (e.g. `005_password_complexity_reuse_lockout.sql`)

| Change | Description |
|--------|-------------|
| **password_policy** | Add columns (or one JSONB) for complexity and reuse: e.g. `password_min_length INT DEFAULT 6`, `password_require_uppercase BOOLEAN DEFAULT true`, `password_require_lowercase BOOLEAN DEFAULT true`, `password_require_number BOOLEAN DEFAULT true`, `password_require_symbol BOOLEAN DEFAULT true`, `password_history_count INT DEFAULT 5` (0 = disable reuse check). |
| **user_password_history** | New table: `id`, `user_id` (FK), `password_hash`, `created_at`. Index `(user_id, created_at DESC)` for “last N” and trim. |
| **users** | Add `failed_login_attempts INT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ DEFAULT NULL`. |

All idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS / DO $$ ... EXCEPTION).

---

## 4. Backend impact

### 4.1 Shared password validator (complexity)

| Item | Description |
|------|-------------|
| **New** | `backend/src/lib/passwordValidation.js` (or similar): one function `validatePassword(password, policy)` that checks length ≥ policy.min_length and, if policy flags are set, checks for at least one uppercase, one lowercase, one digit, one symbol. Returns `{ valid, error }`. Policy can come from DB or defaults. |
| **Used in** | Auth: register, change-password, change-password-expired; Users: POST (manual create). All “set password” flows call it before hashing. |

**API errors:** e.g. 400 with messages like “Password must be at least 6 characters and include uppercase, lowercase, a number, and a symbol.”

### 4.2 Password policy data layer and API

| File | Change |
|------|--------|
| **passwordPolicyDb.js** | `get()` returns new fields (min_length, require_uppercase, require_lowercase, require_number, require_symbol, password_history_count). `update()` accepts and persists them (with sensible bounds). |
| **settings.js** | GET/PUT `/api/settings/password-policy` request/response include the new fields. Validation: min_length 6–128, history_count 0–24, booleans. |

### 4.3 Password history (reuse last 5)

| File | Change |
|------|--------|
| **New: passwordHistoryDb.js** | `getHashesForUser(db, userId, limit)` → last N hashes; `add(db, userId, password_hash)`; `trimToLimit(db, userId, limit)`. |
| **auth.js** | In **change-password** and **change-password-expired**: load policy; if `password_history_count > 0`, load current + history hashes, bcrypt.compare new password to each; if match → 400 “Cannot reuse a recent password”. On success: add current hash to history, updatePassword, trim to N. |
| **users.js** | Manual create: no history check. Admin reset: optionally clear user’s password history when resetting (so the random password doesn’t count as “one of the last 5”). |

### 4.4 Account lockout

| File | Change |
|------|--------|
| **usersDb.js** | `getByEmail` SELECT to include `failed_login_attempts`, `locked_until`. New: `incrementFailedLogin(db, userId)` (increment; if new value ≥ 5, set `locked_until = now() + 30 minutes`). `resetFailedLogin(db, userId)` (set attempts = 0, locked_until = null). `unlockUser(db, userId)` (same as reset – for admin). |
| **auth.js – login** | 1) Get user by email. 2) If user exists and `locked_until` is set and `now() < locked_until`, return **423 Locked** with body e.g. `{ error: "Account locked", code: "ACCOUNT_LOCKED", locked_until: "ISO8601" }` (no attempt counted). 3) If user and correct password: call `resetFailedLogin`, then continue (expiry check, token, audit). 4) If user and wrong password: call `incrementFailedLogin`, return 401 “Invalid email or password”. 5) If no user: return 401 (no DB write, to avoid enumeration). |
| **users.js** | New endpoint **POST /api/users/:id/unlock** (Admin only): call usersDb.unlockUser; audit; return 200. |

**Lockout constants:** 5 attempts and 30 minutes can be env vars (e.g. `LOCKOUT_AFTER_ATTEMPTS`, `LOCKOUT_DURATION_MINUTES`) or later moved to policy; for the first version, constants are fine.

---

## 5. Frontend impact

### 5.1 Password complexity

| Location | Change |
|----------|--------|
| **Admin → Password policy** | Form: “Minimum length” (number); checkboxes or toggles for “Require uppercase”, “Require lowercase”, “Require number”, “Require symbol”; “Prevent reuse of last N passwords” (number, 0 = off). Save via existing PUT. |
| **Register / Change password / Change password expired** | Client-side: validate complexity (and min length) before submit, mirroring server rules, with clear messages (e.g. “Include uppercase, lowercase, a number, and a symbol”). Optional: fetch policy from an endpoint (e.g. GET password-policy for logged-out flows you might expose, or only in Admin); if not, hardcode same rules as backend. |
| **Admin → Add user** | Same complexity validation on the “new user” form. |
| **API error handling** | Display server error when backend returns 400 for complexity (e.g. “Password must include…”). |

### 5.2 Password reuse

| Location | Change |
|----------|--------|
| **Change password / Change password expired** | When API returns 400 “Cannot reuse a recent password”, show that message. |
| **Admin → Password policy** | Field “Prevent reuse of last N passwords” (see above). |

### 5.3 Account lockout

| Location | Change |
|----------|--------|
| **Login** | On 423 with `code: "ACCOUNT_LOCKED"`: show “Account locked due to too many failed attempts. Try again after &lt;time&gt; or contact an administrator to unlock.” Optional: show `locked_until` countdown. Do not treat as generic “Login failed”. |
| **AuthContext / apiRequest** | Ensure 423 and response body (e.g. `locked_until`, `code`) are passed through so Login can branch. |
| **Admin → Users** | For each user: if `locked_until` is set (and &gt; now), show “Locked” and an **Unlock** button. Unlock calls POST `/api/users/:id/unlock`, then refresh list. Optionally show “Locked until &lt;time&gt;”. |

**Users list API:** GET `/api/users` should include `locked_until` (and optionally `failed_login_attempts`) so the Admin UI can show lock status and Unlock.

---

## 6. Summary by layer

| Layer | Changes |
|-------|---------|
| **DB** | One migration: `password_policy` (complexity + history_count), `user_password_history` table, `users` (failed_login_attempts, locked_until). |
| **Backend – new** | `passwordValidation.js`, `passwordHistoryDb.js`. |
| **Backend – extend** | `passwordPolicyDb`, `usersDb` (lock/unlock, getByEmail fields), `auth.js` (complexity on all set-password; reuse check + history update on change-password flows; login lock check + increment/reset), `users.js` (manual create complexity; optional history clear on reset; POST unlock), `settings.js` (policy GET/PUT new fields). |
| **Frontend** | Password policy form (complexity + history); Register, Change password, Change password expired, Add user (complexity + reuse error); Login (423 locked message); Admin Users (locked state + Unlock). |
| **Tests** | Integration: complexity rejection, reuse rejection, successful change; login lock after 5 failures, 423 when locked, reset on success, admin unlock. Update TEST-PLAN / TESTING. |

---

## 7. Suggested implementation order

1. **Migration:** All DB changes (policy columns, history table, users columns).  
2. **Password complexity:** Validator + policy DB + settings API; use validator in auth and users (register, change-password, change-password-expired, manual create); then frontend policy + forms + errors.  
3. **Password reuse:** passwordHistoryDb + policy history_count; auth change-password flows (check + add + trim); optional clear on admin reset; frontend reuse error + policy field.  
4. **Lockout:** usersDb (columns + increment/reset/unlock); auth login (check lock, 423, increment/reset); users route unlock; GET users include locked_until; frontend Login (423 message) and Admin Users (Unlock).  
5. **Tests and docs:** Integration tests for all three; update TEST-PLAN.md and TESTING.md.

---

## 8. Edge cases and decisions

| Topic | Recommendation |
|-------|----------------|
| **Lockout: by email or by user?** | By user (user_id). Failed attempts stored on the user row. |
| **Lockout: reveal “locked” vs “wrong password”?** | Yes: 423 + code when locked so the user sees “Account locked” and “try after 30 min or contact admin”. 401 for wrong password. |
| **Lockout duration and count** | Fixed 5 attempts and 30 minutes for v1; can move to env or policy later. |
| **Admin unlock** | Single “Unlock” action: set failed_login_attempts = 0, locked_until = null. |
| **Complexity: configurable or fixed?** | Configurable in policy (min_length + 4 booleans) so you can relax or tighten per environment. |
| **Reuse: admin reset** | Clear password history when admin resets so the temporary password doesn’t consume one of the “last 5”. |
| **Change-password-expired** | Same complexity and reuse rules as change-password; user is not logged in but we have email + current password. |

---

## 9. Risk and effort

- **Complexity:** Low–medium. Shared validator and policy; many call sites but mechanical.  
- **Reuse:** Medium. New table and history logic; careful ordering (check → update → add to history → trim).  
- **Lockout:** Medium. Login flow and new columns; 423 handling and Admin Unlock; ensure no information leak (e.g. don’t reveal “user exists” by creating a lock record on non-existent email).  

**Overall:** One migration, two new backend modules (validator, history), extensions to auth, users, settings, and frontend. Suitable for a single PRD and tech spec covering all three requirements.

If this scope is acceptable, you can create the PRD and tech spec next; the implementation can follow the order in §7 and the details in this document.
