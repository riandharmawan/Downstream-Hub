# PRD & Tech Spec Review: Analysis and Detailed Development Plan

This document reviews the updated **PRD** (Downstream Hub PRD.docx v3.2) and **Tech Spec** (Downstream Hub Tech Spec.docx v3.2), then provides an analysis and a phased development plan for the new password and lockout requirements.

---

## 1. PRD Summary (Extracted)

**New / updated scope (v3.2):**
- **Configurable Security Policies:** Password Expiry, **Complexity**, **History**, and **Lockout**.
- **Password Security (User Story 2):**  
  - **Complexity:** Minimum 6 characters (default), including uppercase, lowercase, numbers, and symbols.  
  - **No Reuse:** System prevents reuse of the last **X** passwords based on policy.
- **Brute-force Protection (User Story 3):**  
  - **Account Lockout:** Locks after **X** failed attempts (default: 5).  
  - **Recovery:** Auto-unlock after **30 mins** or manual unlock by Admin.
- **Password Policy (Admin) (User Story 4):**  
  - UI: Min Password Length, Complexity toggles, Password History count (e.g. last 5), **Max Login Attempts** before lockout.
- **User Management (Admin) (User Story 7):**  
  - **Reset Password** and **Unlock Account** buttons.

---

## 2. Tech Spec Summary (Extracted)

**Schema:**
- **Users:** `login_attempts` (Integer, default 0), `locked_until` (Timestamp, nullable), `is_deactivated` (Boolean).  
  *(Current codebase uses `deleted_at` for deactivation; see §3 alignment.)*
- **Security_Policies table (New):**  
  `min_password_length` (default 6), `complexity_enabled` (Boolean), `history_limit` (default 5), `max_login_attempts` (default 5), `lockout_duration_mins` (default 30).
- **Password_History:** `id`, `user_id`, `password_hash`, `created_at`.

**Behaviour:**
- Lockout after X failed attempts; lock for 30 mins or until Admin unlock.
- New passwords cannot match last X in Password_History.
- Registration/identity: domain check, complexity from Security_Policies, password === password_retype.
- **SSO:** Tech spec states token via **Authorization: Bearer {JWE_TOKEN}** header. *(Current implementation uses POST body from bridge; see §3.)*
- **Redis:** Spec mentions Redis for “tracking Failed Login Attempts for real-time lockout.” *(Current design uses DB columns; see §3.)*
- **RBAC:** Spec mentions SuperAdmin, BUAdmin, Employee. *(Current code has Admin, Employee; see §3.)*

---

## 3. Analysis: PRD vs Tech Spec vs Current Codebase

| Topic | PRD | Tech Spec | Current codebase | Alignment / decision |
|-------|-----|-----------|------------------|----------------------|
| **Password complexity** | Min 6, upper/lower/number/symbol | Security_Policies: min_password_length, complexity_enabled | Only min 6 today | **Aligned.** Add validator + policy; implement per impact doc. |
| **Password history** | Last X (e.g. 5) | history_limit in Security_Policies; Password_History table | Not implemented | **Aligned.** Add table + history_limit; implement per impact doc. |
| **Lockout** | X attempts (default 5), 30 min or Admin unlock | login_attempts, locked_until on Users; max_login_attempts, lockout_duration_mins in Security_Policies | Not implemented | **Aligned.** Add columns + policy; implement per impact doc. |
| **Policy storage** | Configurable by Admin | **Security_Policies** table (new) with all policy fields | **password_policy** table (password_expiry_days only) | **Choice:** (A) New table `security_policies` per spec, or (B) Extend `password_policy` with new columns. Recommend **(B)** for fewer migrations and one “policy” concept; rename in API/UI to “Security policy” if desired. |
| **Deactivation** | Admin deactivate | users.is_deactivated (Boolean) | users.deleted_at (soft delete) | **Keep deleted_at.** Behaviour is equivalent; no need for is_deactivated. API/UI already use “deactivate” wording. |
| **Lockout storage** | — | Redis for “real-time” failed attempts | — | **Recommend DB-only for v1:** store failed_attempts and locked_until on users. Simpler; no Redis dependency for auth. Add Redis later if needed for cross-instance lockout. |
| **SSO token delivery** | Secure token to target app | **Bearer {JWE_TOKEN}** in header | Token in **POST body** (bridge form) | **Keep current (body) for now.** Doc already describes body in SSO-TARGET-APP-INTEGRATION.md. Tech spec “Bearer header” can be an option for target apps or a later enhancement. |
| **Roles** | Admin/User | SuperAdmin, BUAdmin, Employee | Admin, Employee | **Keep Admin + Employee for this release.** SuperAdmin/BUAdmin can be a later RBAC expansion. |
| **Admin Unlock** | Manual unlock by Admin | audit action UNLOCK | Not implemented | **Aligned.** Add POST /api/users/:id/unlock and Admin “Unlock” button. |

**Summary:** PRD and Tech Spec are consistent with each other and with our earlier impact assessment. Main decisions: (1) Use a single policy store (extend `password_policy` or add `security_policies`); (2) Lockout in DB only for v1; (3) Keep SSO and roles as-is for this release.

---

## 4. Recommended Scope for This Release

Implement in this release:

1. **Password complexity** — Min length + require upper/lower/number/symbol; configurable in policy.
2. **Password history** — Last 5 (configurable); no reuse on change-password flows.
3. **Account lockout** — 5 attempts (configurable), 30 min lock (configurable), Admin unlock.
4. **Security policy (Admin)** — One place: min length, complexity toggles, history count, max login attempts, lockout duration.
5. **Admin Unlock** — Unlock button and API.

Defer:

- Redis for failed-attempt tracking (use DB).
- SSO change to Bearer header (keep body).
- SuperAdmin / BUAdmin roles (keep Admin / Employee).
- Rename `password_policy` to `security_policies` in schema (optional; can extend existing table).

---

## 5. Detailed Development Plan

### Phase 1 — Database and policy layer

| Step | Task | Details |
|------|------|---------|
| 1.1 | **Migration: policy and lockout** | Add to `password_policy` (or create `security_policies`): `min_password_length` (default 6), `require_uppercase`, `require_lowercase`, `require_number`, `require_symbol` (booleans), `password_history_count` (default 5), `max_login_attempts` (default 5), `lockout_duration_mins` (default 30). Backfill existing row. |
| 1.2 | **Migration: password history** | Create table `user_password_history` (id, user_id FK, password_hash, created_at); index (user_id, created_at DESC). |
| 1.3 | **Migration: users lockout** | Add to `users`: `failed_login_attempts INT NOT NULL DEFAULT 0`, `locked_until TIMESTAMPTZ DEFAULT NULL`. |
| 1.4 | **passwordPolicyDb (or securityPolicyDb)** | get() returns all new fields; update() accepts and validates them (min_length 6–128, history 0–24, max_attempts 1–10, lockout_mins 1–1440). |
| 1.5 | **passwordHistoryDb (new)** | getHashesForUser(db, userId, limit), add(db, userId, password_hash), trimToLimit(db, userId, limit). |
| 1.6 | **usersDb** | getByEmail and getById include failed_login_attempts, locked_until. Add incrementFailedLogin(db, userId, maxAttempts, lockoutMins), resetFailedLogin(db, userId), unlockUser(db, userId). |

### Phase 2 — Password complexity and history

| Step | Task | Details |
|------|------|---------|
| 2.1 | **Shared validator** | New `lib/passwordValidation.js`: validatePassword(password, policy) → { valid, error }. Check length and, when policy flags set, at least one upper/lower/digit/symbol. |
| 2.2 | **Auth: register** | Load policy; run validator; 400 with message if invalid. |
| 2.3 | **Auth: change-password & change-password-expired** | Validate new password with policy. If history_count > 0: fetch current + history hashes, bcrypt.compare new to each; if match → 400. On success: add current hash to history, updatePassword, trim history. |
| 2.4 | **Users: manual create** | Validate password with policy. |
| 2.5 | **Users: admin reset** | Optional: clear user’s password history when resetting. |
| 2.6 | **Settings API** | GET/PUT /api/settings/password-policy include and persist all new policy fields. |

### Phase 3 — Account lockout and unlock

| Step | Task | Details |
|------|------|---------|
| 3.1 | **Auth: login** | Get user by email. If user and locked_until and now() < locked_until → 423 { error, code: "ACCOUNT_LOCKED", locked_until }. If user and wrong password → incrementFailedLogin (and set locked_until when attempts ≥ max); return 401. If user and correct password → resetFailedLogin; then expiry check, token, audit. |
| 3.2 | **Users: unlock** | POST /api/users/:id/unlock (Admin only): unlockUser; audit UNLOCK; return 200. |
| 3.3 | **GET /api/users** | Include locked_until (and optionally failed_login_attempts) so Admin UI can show lock status. |

### Phase 4 — Frontend

| Step | Task | Details |
|------|------|---------|
| 4.1 | **Admin → Password / Security policy** | One section: Min length, Complexity toggles (upper/lower/number/symbol), History count, Max login attempts, Lockout duration (mins). Save via PUT /api/settings/password-policy. |
| 4.2 | **Register / Change password / Change password expired / Add user** | Client-side complexity validation; show server error for complexity and “cannot reuse recent password”. |
| 4.3 | **Login** | On 423 with ACCOUNT_LOCKED: show “Account locked… Try again after &lt;time&gt; or contact admin.” |
| 4.4 | **Admin → Users** | Show “Locked” and **Unlock** button when locked_until is set; call POST /api/users/:id/unlock and refresh. |

### Phase 5 — Tests and docs

| Step | Task | Details |
|------|------|---------|
| 5.1 | **Integration tests** | Complexity rejection; reuse rejection; lockout after N failures; 423 when locked; reset on success; admin unlock; policy GET/PUT. |
| 5.2 | **TEST-PLAN.md / TESTING.md** | Add scenarios for complexity, history, and lockout. |
| 5.3 | **Optional** | Update PRD/Tech Spec change log when implementation is done. |

---

## 6. Implementation Order (Sprint-Friendly)

1. **Week 1 (or Sprint 1):** Phase 1 (migrations + DB layer).  
2. **Week 2:** Phase 2 (complexity + history) and Phase 3 (lockout + unlock).  
3. **Week 3:** Phase 4 (frontend).  
4. **Week 4 (or buffer):** Phase 5 (tests, docs, regression).

---

## 7. File Checklist (Quick Reference)

| Area | Files to add | Files to modify |
|------|----------------|------------------|
| **DB** | `migrations/005_security_policy_password_history_lockout.sql` | — |
| **Backend** | `lib/passwordValidation.js`, `db/passwordHistoryDb.js` | `db/passwordPolicyDb.js`, `db/usersDb.js`, `routes/auth.js`, `routes/users.js`, `routes/settings.js` |
| **Frontend** | — | `pages/Login.jsx`, `pages/Register.jsx`, `pages/ChangePassword.jsx`, `pages/ChangePasswordExpired.jsx`, `context/AuthContext.jsx` (if 423 handling), `pages/Admin.jsx` (policy form + Unlock) |
| **Tests** | — | `__tests__/integration/api.integration.test.js` |
| **Docs** | — | `TEST-PLAN.md`, `TESTING.md` |

---

## 8. Conclusion

- **PRD and Tech Spec** are consistent and implementable; the main divergence (Redis, SSO header, roles) is captured and scoped out for this release.
- **Development plan** above is aligned with both documents and with the existing impact assessment; you can use it as the basis for PRD/Tech Spec implementation and for sprint planning.
- **Policy storage:** Extending the existing `password_policy` table is recommended unless you explicitly want a separate `security_policies` table per Tech Spec naming.

If you confirm the policy table choice (extend `password_policy` vs new `security_policies`) and any tweaks to defaults (e.g. lockout 5 attempts / 30 min), implementation can proceed in the order above.
