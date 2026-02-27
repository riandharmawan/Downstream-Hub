# Build Plan: Security Policy (Complexity, History, Lockout)

This plan adds **password complexity**, **password history**, and **account lockout** without breaking existing behaviour. Each step is additive or backward-compatible; verification steps confirm nothing is broken.

**Principle:** New columns have defaults; new code paths run only when policy values are set; existing API responses keep existing fields; existing tests keep passing.

---

## Pre-requisites

- Current codebase: auth (register, login, change-password, change-password-expired), users (list, PATCH BU, POST create, deactivate, reset-password), password_policy (GET/PUT with password_expiry_days), Admin UI (Users, Password policy).
- Run existing integration tests before starting: `cd backend && npm test`. All must pass.

---

## Phase 1 — Database (additive only)

### Step 1.1 — Migration: extend password_policy and add lockout/history

**File:** `backend/src/db/migrations/005_security_policy_and_lockout.sql` (new)

**Content:**

- Add columns to **password_policy** with defaults (so existing row and existing code keep working):
  - `min_password_length INT NOT NULL DEFAULT 6`
  - `require_uppercase BOOLEAN NOT NULL DEFAULT true`
  - `require_lowercase BOOLEAN NOT NULL DEFAULT true`
  - `require_number BOOLEAN NOT NULL DEFAULT true`
  - `require_symbol BOOLEAN NOT NULL DEFAULT true`
  - `password_history_count INT NOT NULL DEFAULT 5` (0 = disable reuse check)
  - `max_login_attempts INT NOT NULL DEFAULT 5`
  - `lockout_duration_mins INT NOT NULL DEFAULT 30`
- Use `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` and `EXCEPTION WHEN duplicate_column THEN NULL` for each so migration is idempotent.
- Add columns to **users**: `failed_login_attempts INT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ DEFAULT NULL` (same idempotent pattern).
- Create **user_password_history** table: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id)`, `password_hash VARCHAR(255) NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Index: `CREATE INDEX idx_user_password_history_user_created ON user_password_history(user_id, created_at DESC);`

**Do not:** Drop or rename existing columns; change existing defaults for `password_expiry_days`.

**Verification:** Run migrations (`npm run` backend or start app); `SELECT * FROM password_policy` shows one row with new columns; `SELECT failed_login_attempts, locked_until FROM users LIMIT 1` works. Existing `GET /api/settings/password-policy` still returns `password_expiry_days` (we extend response in Step 2.6).

---

### Step 1.2 — Extend passwordPolicyDb (backward-compatible)

**File:** `backend/src/db/passwordPolicyDb.js`

**Changes:**

- **get(db):** `SELECT` all columns from `password_policy` (password_expiry_days plus new ones). Return object with every column; for any column missing (old DB), provide default in code: e.g. `min_password_length: row.min_password_length ?? 6`, `password_history_count: row.password_history_count ?? 5`, etc.
- **update(db, payload):** Keep existing behaviour: always allow `password_expiry_days`. Add optional keys: `min_password_length`, `require_uppercase`, `require_lowercase`, `require_number`, `require_symbol`, `password_history_count`, `max_login_attempts`, `lockout_duration_mins`. Build dynamic UPDATE: only set columns that are present in payload; validate ranges (e.g. min_length 6–128, history 0–24, max_attempts 1–10, lockout_mins 1–1440). If payload has only `password_expiry_days`, behaviour is identical to today.

**Do not:** Remove or change the existing `password_expiry_days` read/update logic.

**Verification:** Existing PUT with only `password_expiry_days` still works. GET still returns `password_expiry_days`. New fields appear in GET once migration is applied; PUT can accept new fields without breaking old clients.

---

### Step 1.3 — Add passwordHistoryDb (new module)

**File:** `backend/src/db/passwordHistoryDb.js` (new)

**Exports:**

- `getHashesForUser(db, userId, limit)` → array of `{ password_hash }` (last `limit` by created_at DESC).
- `add(db, userId, password_hash)` → insert one row.
- `trimToLimit(db, userId, limit)` → delete rows for user beyond the last `limit` (keep most recent `limit`).

**Do not:** Touch users table or password_policy.

**Verification:** Require the module in a test or temporary route; call add, getHashesForUser, trimToLimit; no impact on login or register.

---

### Step 1.4 — Extend usersDb (additive)

**File:** `backend/src/db/usersDb.js`

**Changes:**

- In **getByEmail**, **getById**, and **listWithBu** SELECTs, add `failed_login_attempts`, `locked_until` to the column list (so login and GET /api/users get them). Existing callers that ignore these fields are unchanged.
- Add **incrementFailedLogin(db, userId, maxAttempts, lockoutMins):** increment `failed_login_attempts` by 1; if new value >= maxAttempts, set `locked_until = now() + (lockoutMins * interval '1 minute')`. Use single UPDATE with CASE/subquery.
- Add **resetFailedLogin(db, userId):** set `failed_login_attempts = 0`, `locked_until = null`.
- Add **unlockUser(db, userId):** same as resetFailedLogin (or alias). Used by Admin unlock.

**Do not:** Change getByEmail/getById return shape for existing fields; do not add required parameters to existing functions.

**Verification:** Login and register still work. New functions are unused until Phase 3; no behaviour change yet.

---

## Phase 2 — Password complexity and history (guarded by policy)

### Step 2.1 — Shared password validator (new module)

**File:** `backend/src/lib/passwordValidation.js` (new)

**Export:** `validatePassword(password, policy)` where policy has `min_password_length`, `require_uppercase`, `require_lowercase`, `require_number`, `require_symbol`. Returns `{ valid: boolean, error?: string }`. If valid, error is undefined. Check: length >= min_password_length; if require_uppercase, at least one A–Z; same for lower, digit, symbol (regex or simple loops). If policy flags are false, skip that check (so policy can “disable” complexity).

**Do not:** Call DB or auth; pure function.

**Verification:** Unit test or ad-hoc: validatePassword('Abc1!', defaultPolicy) → valid; validatePassword('abc', defaultPolicy) → invalid (length or missing upper/number/symbol).

---

### Step 2.2 — Settings API: return and accept new policy fields

**File:** `backend/src/routes/settings.js`

**Changes:**

- **GET /api/settings/password-policy:** After `passwordPolicyDb.get(pool)`, return all policy fields in the JSON (password_expiry_days plus min_password_length, require_uppercase, require_lowercase, require_number, require_symbol, password_history_count, max_login_attempts, lockout_duration_mins). Existing clients that only read `password_expiry_days` are unchanged.
- **PUT /api/settings/password-policy:** Accept optional body fields for the new columns. Validate ranges; call `passwordPolicyDb.update(client, { ... })` with all provided fields. Still require at least one field or keep current behaviour: if only `password_expiry_days` is sent, only update that (so existing Admin UI still works). Merge with current policy so unspecified keys are not overwritten with undefined.

**Do not:** Remove or change the existing password_expiry_days handling; do not require new fields for PUT.

**Verification:** Existing GET/PUT from Admin (expiry only) still work. New fields appear in GET; PUT with new fields updates DB.

---

### Step 2.3 — Auth: register — add complexity check only

**File:** `backend/src/routes/auth.js`

**Changes:**

- In **POST /register**, after existing checks (email, password_retype, email format, length >= 6), load policy: `const policy = await passwordPolicyDb.get(pool);`. Call `validatePassword(password, policy)`. If !valid, return 400 with message (e.g. policy.error). Then continue with domain check, hash, create user.
- Use policy defaults from get() so if any column is missing (e.g. old DB), validator still gets safe defaults.

**Do not:** Change domain check, BU check, or user creation logic. Keep same 400/409/500 cases.

**Verification:** Register with a password that fails complexity (e.g. "password" without symbol) → 400. Register with valid complexity (e.g. "Password1!") → 201. Existing integration tests for register (missing email, wrong retype, invalid email, short password) still pass; add one test for “valid complexity required” if desired.

---

### Step 2.4 — Auth: change-password and change-password-expired — complexity + history

**File:** `backend/src/routes/auth.js`

**Changes:**

- **POST /api/auth/change-password** (authenticated): After validating current password and new_password_retype, load policy. Run validatePassword(new_password, policy); if invalid, 400. If policy.password_history_count > 0: load user’s current password_hash and getHashesForUser(pool, userId, policy.password_history_count); for each hash, bcrypt.compare(new_password, hash); if any match, return 400 “Cannot reuse a recent password.” On success: get current password_hash from user, then updatePassword; then passwordHistoryDb.add(pool, userId, currentPasswordHash); then passwordHistoryDb.trimToLimit(pool, userId, policy.password_history_count). Order: validate → history check → updatePassword → add current to history → trim.
- **POST /api/auth/change-password-expired:** Same: validate new password with policy; history check (current + last N); on success updatePassword, add current to history, trim.

**Do not:** Change expiry check logic or token response. Ensure “current” hash is the one before updatePassword (read user again if needed before update).

**Verification:** Change password with new password failing complexity → 400. Change password with new password same as current → 400 “Cannot reuse…”. Change password with new password different and valid → 200. Existing tests for change-password (wrong current, mismatch retype) still pass.

---

### Step 2.5 — Users: manual create — complexity only

**File:** `backend/src/routes/users.js`

**Changes:**

- In **POST /api/users**, after existing validation (email, password_retype, length >= 6, domain, BU), load policy and run validatePassword(password, policy). If invalid, 400. Then hash and create.

**Do not:** Change role, domain, or BU logic; do not require history (new user has no history).

**Verification:** Admin create user with weak password → 400; with valid complexity → 201.

---

### Step 2.6 — Users: admin reset — clear password history (optional)

**File:** `backend/src/db/passwordHistoryDb.js` and `backend/src/routes/users.js`

**Changes:**

- Add **deleteForUser(db, userId)** in passwordHistoryDb (DELETE FROM user_password_history WHERE user_id = $1). In **POST /api/users/:id/reset-password**, after updating password, call passwordHistoryDb.deleteForUser(pool, id). So the temporary password does not count toward “last 5.”

**Do not:** Change the reset-password response or token generation.

**Verification:** Admin reset password; user then changes password 5 times; 6th change to a previous password still blocked by history (current hash is not in history because we cleared on reset). Optional test.

---

## Phase 3 — Account lockout and unlock

### Step 3.1 — Auth: login — lock check and increment/reset

**File:** `backend/src/routes/auth.js`

**Changes:**

- In **POST /login**, after getByEmail: if !user, return 401 “Invalid email or password” (no DB write; same as now).
- If user exists: if user.locked_until and new Date(user.locked_until) > new Date(), return 423 with body { error: "Account locked", code: "ACCOUNT_LOCKED", locked_until: user.locked_until }. Do not increment attempts when locked.
- Compare password: if wrong, call usersDb.incrementFailedLogin(pool, user.id, policy.max_login_attempts, policy.lockout_duration_mins); return 401.
- If correct: call usersDb.resetFailedLogin(pool, user.id); then continue with expiry check, token, audit, response (unchanged). Load policy once at start of login (for max_login_attempts and lockout_duration_mins); use defaults if policy missing.

**Do not:** Change 401 message for wrong password; do not change success response shape; do not skip expiry check.

**Verification:** Login with wrong password 5 times → 6th attempt returns 423 (or 401 until lock). After 30 min (or admin unlock), login succeeds. Successful login clears attempts and locked_until. Existing login and expiry tests still pass.

---

### Step 3.2 — Users: GET /api/users include lock fields; POST unlock

**File:** `backend/src/routes/users.js`

**Changes:**

- **GET /api/users:** In the map over rows, add `locked_until: r.locked_until` (and optionally `failed_login_attempts: r.failed_login_attempts`). usersDb.listWithBu must SELECT these columns; add them to the SELECT in usersDb.listWithBu.
- **POST /api/users/:id/unlock:** New route (before PATCH /:id so :id doesn’t capture "unlock"). Auth + requireAdmin. Get user by id; if !user return 404. Call usersDb.unlockUser(pool, id). Audit with actionType 'UNLOCK', targetEntity `user:${user.email}`. Return 200 { message: 'Account unlocked' }.

**Do not:** Change PATCH /:id or other routes. Ensure GET /api/users still returns the same shape for existing fields.

**Verification:** GET /api/users returns locked_until. POST /api/users/:id/unlock as Admin unlocks; then login for that user succeeds.

---

## Phase 4 — Frontend (additive and guarded)

### Step 4.1 — Admin: Password policy section — new fields

**File:** `frontend/src/pages/Admin.jsx`

**Changes:**

- State: add fields for min_password_length, require_uppercase, require_lowercase, require_number, require_symbol, password_history_count, max_login_attempts, lockout_duration_mins (or one state object “policy”). Load them from GET /api/settings/password-policy (already returns password_expiry_days; extend to set new state from response).
- Form: add inputs for min length (number), four checkboxes for complexity, number for history count, number for max login attempts, number for lockout duration. On submit, send all policy fields in PUT body (include password_expiry_days and new ones). Keep existing “Password expires after (days)” field and behaviour.

**Do not:** Remove or break the existing password expiry field and save flow.

**Verification:** Admin can set expiry as before; can set new fields; after save, GET shows new values. Existing “Password policy” section still works.

---

### Step 4.2 — Register, Change password, Change password expired, Add user — validation and errors

**Files:** `frontend/src/pages/Register.jsx`, `ChangePassword.jsx`, `ChangePasswordExpired.jsx`, `Admin.jsx` (Add user form)

**Changes:**

- Client-side: before submit, validate password (min length and, if you have policy in context, complexity). Show inline error (e.g. “Include uppercase, lowercase, a number, and a symbol”). Optional: fetch policy from a public or authenticated endpoint to drive validation; otherwise hardcode same rules as backend.
- On API error: if response body has message about complexity or “reuse”, display it (e.g. setError(res.body.error)).

**Do not:** Change submit URLs or success redirects. Do not require policy fetch for basic validation (can use fixed rules).

**Verification:** Submit weak password → client or server error shown. Submit valid password → success as today.

---

### Step 4.3 — Login: handle 423 Account locked

**Files:** `frontend/src/context/AuthContext.jsx`, `frontend/src/pages/Login.jsx`

**Changes:**

- In login flow, if response status is 423 and body.code === 'ACCOUNT_LOCKED', do not treat as generic error. Set a specific message, e.g. “Account locked due to too many failed attempts. Try again after [time] or contact an administrator.” Optionally show locked_until from body. In Login.jsx, branch on 423 to show this message (and optionally a countdown).

**Do not:** Change handling of 401 or PASSWORD_EXPIRED (redirect to change-password-expired). Ensure 423 is passed through from API (res.status, res.body) in your apiRequest or fetch wrapper.

**Verification:** Lock account (5 wrong logins); on next attempt, user sees account locked message. After unlock or 30 min, login works.

---

### Step 4.4 — Admin: Users — show Locked and Unlock button

**File:** `frontend/src/pages/Admin.jsx`

**Changes:**

- In the users table, add a column or cell for “Status” or reuse “Actions”: if user.locked_until and new Date(user.locked_until) > new Date(), show “Locked” and a button “Unlock”. On Unlock, call POST /api/users/:id/unlock with token; on success refresh user list. Optionally show “Locked until &lt;time&gt;”.

**Do not:** Remove Edit BU, Reset password, or Deactivate. Add Unlock only when locked.

**Verification:** Locked user shows Unlock; after Unlock, status clears and user can log in.

---

## Phase 5 — Tests and docs

### Step 5.1 — Integration tests

**File:** `backend/src/__tests__/integration/api.integration.test.js`

**Changes:**

- Add tests (can be in a new describe or existing): complexity rejection on register (e.g. password without symbol); reuse rejection on change-password (mock or real history); lockout: login wrong 5 times then get 423; login success resets lock; admin unlock then login succeeds. Use existing app and pool; ensure policy has required fields (from migration defaults).

**Do not:** Remove or relax existing tests. Fix any tests that assume “no policy” or “no lockout” (e.g. ensure test user is not locked).

**Verification:** `npm test` passes; new tests pass.

---

### Step 5.2 — Docs

**Files:** `docs/TEST-PLAN.md`, `TESTING.md`, `README.md`, `technical-architecture.md`

**Changes:** Per docs/README-AND-ARCHITECTURE-IMPACT.md: add security policy and lockout to scope, phases, user stories; update schema and flows in technical-architecture.md; add test scenarios.

**Verification:** Read-through; links and version refs correct.

---

## Rollback and safety

- **Migrations:** Migration 005 only adds columns and one table; it does not drop or rename. To rollback, you would add a new migration that drops the new columns and table (not recommended once in production); prefer to leave schema and disable behaviour via policy (e.g. history_count = 0, complexity toggles off).
- **Backend:** All new behaviour is gated by policy (history_count > 0, complexity flags, or lockout columns). If policy defaults are “permissive” (e.g. complexity off), existing passwords still work until policy is tightened.
- **Frontend:** New fields are additive; old Admin UI that only sends password_expiry_days still works if backend accepts partial PUT and merges with current policy.

---

## Order summary (no breakage)

| Order | Step | Breaks if skipped? |
|-------|------|--------------------|
| 1.1 | Migration 005 | New code expects columns/tables. |
| 1.2 | passwordPolicyDb extend | Settings and auth need new fields. |
| 1.3 | passwordHistoryDb new | Change-password history needs it. |
| 1.4 | usersDb extend | Login lockout and GET users need it. |
| 2.1 | passwordValidation new | All password flows use it. |
| 2.2 | Settings GET/PUT new fields | Admin UI and auth need policy. |
| 2.3 | Register complexity | — |
| 2.4 | Change-password complexity + history | — |
| 2.5 | Manual create complexity | — |
| 2.6 | Reset clear history | Optional. |
| 3.1 | Login lockout | — |
| 3.2 | GET users lock fields + POST unlock | — |
| 4.1–4.4 | Frontend | — |
| 5.1–5.2 | Tests and docs | — |

Implement in this order; after each phase run `npm test` and a quick manual check (register, login, change password, Admin policy and users). This keeps existing behaviour intact while adding security policy features.
