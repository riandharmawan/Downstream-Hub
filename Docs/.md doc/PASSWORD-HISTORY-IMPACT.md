# Change Impact: Prevent Reuse of Past Passwords

This document assesses the impact of adding the requirement: **users cannot set a new password that matches any of their recent (past) passwords**.

---

## 1. Requirement clarification

- **Scope:** When a user **changes their own password** (authenticated change-password or change-password-expired), the new password must not equal:
  - their **current** password, or
  - any of their **last N** previous passwords (e.g. last 12).
- **Common policy:** A configurable **history count** (e.g. 12 or 24). If set to 0, the feature is disabled.
- **Out of scope (typical):** Admin **reset password** and **manual user creation** are often exempt (no history for a freshly set random/admin-chosen password), but you can include them if desired.

---

## 2. High-level design

- **Store** previous password hashes per user (e.g. in a `user_password_history` table: `user_id`, `password_hash`, `created_at`). Keep only the last N per user (N = policy setting).
- **Policy:** Add a setting (e.g. `password_history_count` in `password_policy`). 0 = disabled; 1–24 = number of past passwords to check.
- **On password change:** Before saving the new password, compare the new password (via `bcrypt.compare`) against the current hash and against each hash in history. If any match → return 400 "Cannot reuse a recent password". On success, add the **current** (old) hash to history, then update the user to the new hash, then trim history to last N.

---

## 3. Change impact by area

### 3.1 Database

| Change | Description |
|--------|-------------|
| **New table** | `user_password_history` with columns: `id` (PK), `user_id` (FK to users), `password_hash` (VARCHAR), `created_at` (TIMESTAMPTZ). Index on `(user_id, created_at)` for efficient fetch and trim. |
| **New migration** | e.g. `005_password_history.sql`: create table; optionally add `password_history_count INT NOT NULL DEFAULT 0` to `password_policy` (new column + backfill). |
| **password_policy** | Add column `password_history_count` (0 = disabled, 1–24 = remember that many). Existing row updated to 0 so current behaviour is unchanged. |

**Impact:** One new migration; no change to existing tables except optional new column on `password_policy`.

---

### 3.2 Backend — data layer

| File | Change |
|------|--------|
| **New: `backend/src/db/passwordHistoryDb.js`** | Functions: `getHashesForUser(db, userId, limit)` → returns array of `{ password_hash }` ordered by `created_at DESC`; `add(db, userId, password_hash)` → insert one row; `trimToLimit(db, userId, limit)` → keep only the last `limit` rows per user (delete older). |
| **`backend/src/db/usersDb.js`** | No change to function signatures. Optional: ensure `getByEmail` / `getById` still return `password_hash` where already used (they do). |
| **`backend/src/db/passwordPolicyDb.js`** | `get()` to return `password_history_count` (default 0). `update()` to accept and persist `password_history_count` (clamp 0–24). |

**Impact:** One new DB module; small, additive changes to password policy DB.

---

### 3.3 Backend — auth routes

| File | Change |
|------|--------|
| **`backend/src/routes/auth.js`** | **POST /api/auth/change-password:** After validating current password and new password format, load policy; if `password_history_count > 0`, load user’s current hash + history hashes (e.g. `getHashesForUser(..., policy.password_history_count)`); compare new password with current and each history hash (bcrypt); if any match → 400 "Cannot reuse a recent password". On success: add current hash to history, call `updatePassword`, then trim history to `password_history_count`. |
| **`backend/src/routes/auth.js`** | **POST /api/auth/change-password-expired:** Same logic: before updating, if policy has history count > 0, check new password against current + history; if reuse → 400. On success: add current to history, updatePassword, trim. |

**Impact:** Two endpoints updated; shared helper (e.g. `isPasswordInHistory(userId, newPasswordPlain, pool)`) keeps logic in one place.

---

### 3.4 Backend — admin user creation and reset

| File | Change |
|------|--------|
| **`backend/src/routes/users.js`** | **POST /api/users** (manual create): No history yet for new user → **no check**. No change unless you want to enforce “not same as a deleted user’s hash” (unusual). |
| **`backend/src/routes/users.js`** | **POST /api/users/:id/reset-password:** Admin sets a random password. **Recommendation:** Do **not** check history (user did not choose the password; next time they change it, history will apply). Optionally **clear** or **reset** history for that user so the random password is not considered “reused” later (e.g. clear history rows for user so the next user-chosen password has a clean slate). |

**Impact:** Optional: clear history when admin resets password so the new random password is not stored as “recent” and does not block the user’s first self-chosen password.

---

### 3.5 Backend — settings (password policy)

| File | Change |
|------|--------|
| **`backend/src/routes/settings.js`** | **GET /api/settings/password-policy:** Include `password_history_count` in the JSON response. |
| **`backend/src/routes/settings.js`** | **PUT /api/settings/password-policy:** Accept `password_history_count` in body (0–24); validate and pass to `passwordPolicyDb.update`. |

**Impact:** Small additive changes to existing endpoints.

---

### 3.6 Frontend

| File | Change |
|------|--------|
| **Admin → Password policy** | Add a field “Prevent reuse of last N passwords” (number input, 0 = disabled, 1–24). Show and persist `password_history_count` together with “Password expires after (days)”. |
| **Change password / Change password expired pages** | When the API returns 400 with a message like “Cannot reuse a recent password”, display it (e.g. “You cannot reuse a recent password”). No other UI change if API messages are already shown. |

**Impact:** One new setting in Admin; error message handling on change-password flows.

---

### 3.7 Tests

| Area | Change |
|------|--------|
| **Integration** | Add tests: (1) change-password with new password = current password → 400 and message about reuse; (2) change-password with new password = an old password (after setting history count and having history) → 400; (3) change-password with new password different from current and history → 200; (4) password_history_count = 0 → no reuse check (e.g. can “reuse” current). |
| **TEST-PLAN.md / TESTING.md** | Add scenarios for “password history” / “cannot reuse recent password”. |

**Impact:** New integration tests; doc updates.

---

## 4. Summary table

| Layer | Impact |
|-------|--------|
| **Database** | New table `user_password_history`; new column `password_policy.password_history_count` (optional but recommended). |
| **Backend DB** | New `passwordHistoryDb.js`; extend `passwordPolicyDb` for history count. |
| **Backend routes** | Auth: change-password + change-password-expired check history and add to history; Settings: GET/PUT password-policy include history count; Users: optional clear history on admin reset. |
| **Frontend** | Admin password policy: one new field; change-password UIs: show reuse error. |
| **Tests & docs** | Integration tests for reuse; update test plan / testing docs. |

---

## 5. Suggested implementation order

1. Migration: create `user_password_history`, add `password_history_count` to `password_policy`.
2. `passwordHistoryDb.js`: getHashesForUser, add, trimToLimit.
3. Extend `passwordPolicyDb` and settings routes for `password_history_count`.
4. Auth: shared “check reuse” helper; use it in change-password and change-password-expired; after successful update, add current hash to history and trim.
5. (Optional) Admin reset: clear history for that user.
6. Frontend: Admin UI for history count; error message for reuse.
7. Integration tests and doc updates.

---

## 6. Edge cases

- **First-time change:** User has no history → only check “new ≠ current”.
- **History count 0:** Skip history fetch and check; only “new ≠ current” if you still want to disallow reusing current.
- **Concurrent changes:** Single update per user; trim after each change. No need for locking if you always “add then trim” in one flow.
- **Admin reset:** If you do not clear history, the random password will be stored when the user next changes password (current becomes history). So either clear history on reset or accept that the random password enters history once.

This impact assessment should be enough to implement “user can’t use past password” without changing the rest of the app’s behaviour beyond the points above.
