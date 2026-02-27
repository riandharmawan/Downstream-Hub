# Impact of Security Policy Changes on README and Technical Architecture

This document assesses how the new requirements (password complexity, password history, account lockout) affect **[README.md](../README.md)** and **[technical-architecture.md](../technical-architecture.md)**. Each section lists what currently exists and what should be updated when the feature is implemented.

---

## 1. README.md — Impact Summary

| Section | Current state | Impact / required change |
|--------|----------------|---------------------------|
| **What's In Scope** | Describes identity, domain whitelist, BUs, Admin, SSO, audit, **password expiry**, soft delete. | **Add** (or extend the bullet on password/security): configurable **password complexity** (min length, uppercase/lowercase/number/symbol), **password history** (no reuse of last X), **account lockout** (lock after X failed attempts; unlock after 30 min or by Admin). Mention Admin **Unlock** and that policy is set in Admin → Password policy (or “Security policy”). |
| **Implementation Phases (Completed)** | Table ends with “Password expiry” phase Done. | **Add** one row (or extend Password expiry row): e.g. “**Security policy:** Complexity, history (last X), lockout (X attempts, 30 min / Admin unlock); Admin Unlock in Users.” Status: Pending → Done when implemented. |
| **User Flow** | 5 steps: Identity validation, Login, Dashboard, App selection, Redirect & SSO. | **Optional:** Add a note that **Login** may return “account locked” (user must wait or contact Admin), and that **password change** (registration or change-password) must meet complexity and cannot reuse the last X passwords. |
| **User Stories (Summary)** | Table has Identity, Domain validation, BUs, Discovery, Admin Console, SSO. No explicit “Password security” or “Lockout.” | **Add** (or merge into Identity/Admin): one row for **Password security** (complexity + no reuse) and one for **Brute-force protection** (lockout, 30 min / Admin unlock), with key acceptance criteria. Optionally add **Admin** row: “Unlock locked accounts; configure security policy (complexity, history, lockout).” |
| **Tech Stack** | PostgreSQL, Redis for “short-lived SSO tokens.” | **No change** if lockout is implemented in DB only. If later you use Redis for failed-attempt tracking, add a line that Redis is also used for lockout (optional). |
| **Admin console structure** | Sidebar: Domains, Business Units, Users, Applications; “Password policy” mentioned in docs. | **Clarify** that the **Password policy** (or Security policy) section includes: expiry, **min length**, **complexity toggles**, **password history count**, **max login attempts**, **lockout duration**; and that **Users** includes an **Unlock** action for locked accounts. |
| **Quick Start** | “Register… password, confirm password, Business Unit.” | **Optional:** One line that “Passwords must meet complexity rules (configurable in Admin → Password policy).” No need to change Docker or env steps. |
| **Documentation** | Links to PRD and Tech Spec. | **Optional:** Bump or note PRD/Tech Spec version (e.g. v3.2) if you reference versions in text. |

**Summary for README:** Add security policy (complexity, history, lockout) and Admin Unlock to scope and phases; optionally add user stories and a short note in User Flow and Quick Start. No structural or tech-stack change required if lockout stays in DB.

---

## 2. technical-architecture.md — Impact Summary

| Section | Current state | Impact / required change |
|--------|----------------|---------------------------|
| **Header / reference** | “Tech Spec v2.1 / PRD v2.0.” | **Update** to current versions (e.g. Tech Spec v3.2, PRD v3.2) when the feature is released. |
| **§1.1 Components (table)** | Backend: “authentication, RBAC, metadata CRUD.” | **Add** to Backend responsibility: “**Security policy enforcement** (password complexity, history, account lockout).” |
| **§1.3 Admin Console (table)** | Users: “List users and assign/update each user’s Business Unit.” | **Extend** Users row: “List users, assign/update BU, **unlock locked accounts**. **Password policy** section: set expiry, **min length**, **complexity**, **history count**, **max login attempts**, **lockout duration**.” |
| **§3.3 Users Table** | Columns: id, email, password_hash, role, business_unit_id, password_changed_at, deleted_at. | **Add** columns: **`failed_login_attempts`** (INT NOT NULL DEFAULT 0), **`locked_until`** (TIMESTAMPTZ nullable). Describe: used for lockout; reset on successful login; set when failed attempts ≥ policy max; cleared by Admin unlock or after lockout_duration_mins. |
| **§3.3a Password Policy Table** | id, password_expiry_days, updated_at. | **Add** columns (or document a single “security policy” row): **min_password_length** (default 6), **require_uppercase** / **require_lowercase** / **require_number** / **require_symbol** (booleans), **password_history_count** (default 5, 0 = off), **max_login_attempts** (default 5), **lockout_duration_mins** (default 30). Update “GET/PUT /api/settings/password-policy” to include these. |
| **New table: Password History** | Not present. | **Add** **§3.3b** (or 3.4 and renumber): **user_password_history** — `id`, `user_id` (FK), `password_hash`, `created_at`. Purpose: store last N password hashes per user; used to reject “reuse of last X passwords” on change-password. Index (user_id, created_at DESC); trim to last N per user after each change. |
| **§3.4 Applications** | — | If you insert §3.3b, **renumber** Applications and all following sections (3.5 Audit, 3.6 SSO Access Logs, 3.7 Soft Delete) accordingly. |
| **§4.1 Identity Validation** | Describes domain check, password_retype, BU. | **Add:** Password must meet **complexity** rules from policy (min length and, when enabled, at least one of upper/lower/number/symbol). **Add:** On **change-password** (and change-password-expired), new password must not match **current** or any of the **last N** hashes in **user_password_history** (N = password_history_count). |
| **§4.2a Password Expiry** | Describes password_expiry_days, login 403 PASSWORD_EXPIRED, change-password-expired, change-password. | **Rename or extend** to **“§4.2a Password and Security Policy”**. **Add:** (1) **Login:** Before password check, if user exists and **locked_until** is set and **now() &lt; locked_until**, return **423** with `code: ACCOUNT_LOCKED` and optional `locked_until`; do not increment attempts. (2) **Login – wrong password:** Increment **failed_login_attempts**; if new value ≥ **max_login_attempts**, set **locked_until = now() + lockout_duration_mins**; return 401. (3) **Login – success:** Set **failed_login_attempts = 0**, **locked_until = null**. (4) **Admin unlock:** **POST /api/users/:id/unlock** (Admin only) sets failed_login_attempts = 0 and locked_until = null; audit **UNLOCK**. (5) **Change-password flows:** Validate new password against complexity and history as in §4.1. |
| **§4.3 SSO** | Token delivery and validation. | **No change** for this feature. |
| **§4.4 Caching (Redis)** | Redis for SSO tokens / latency. | **No change** if lockout is DB-only. If later you store failed attempts in Redis, add a sentence that Redis is also used for lockout tracking. |
| **§5 Security & Risk Mitigation** | Token expiration, header-based auth, Admin checks, domain lockout, secrets, validation. | **Add** rows: **Account lockout** — after X failed logins, account is locked for Y minutes; Admin can unlock; reduces brute-force risk. **Password complexity and history** — configurable min length and character types; last X passwords cannot be reused. |
| **§7.2 Administrative Audit Trail** | “Admin CRUD… user BU assignment, and login.” action_type: CREATE, UPDATE, DELETE, LOGIN. | **Add** **UNLOCK** (and optionally **POLICY_UPDATE**) to the list of recorded actions; **UNLOCK** when Admin unlocks a user. |
| **§9 Security Mitigation (Audit Focus)** | Tamper-proofing, alerting for “repeated failed login attempts.” | **Add** that **account lockout** is enforced (X attempts → lock for Y min or until Admin unlock), and that **password history** prevents reuse of the last X passwords. |

**Summary for technical-architecture.md:** Update header refs; extend Backend and Admin tables; add Users columns and Password Policy columns; add Password History table and renumber if needed; extend §4.1 and §4.2a with complexity, history, lockout, and unlock; add security rows in §5 and §9; add UNLOCK (and optionally POLICY_UPDATE) to audit. No change to SSO or Redis sections if lockout is DB-only.

---

## 3. Suggested Order of Doc Updates

When implementing the feature:

1. **After DB migrations and backend behaviour are done:** Update **technical-architecture.md** (§3 schema, §4.1, §4.2a, §5, §7.2, §9) so the architecture doc matches the built system.
2. **After Admin UI and Login UX are done:** Update **README.md** (scope, phases, user stories, Admin/Quick Start notes) so the README matches what users and admins see.
3. **Optional:** Bump PRD/Tech Spec version references to v3.2 in both docs.

This keeps the docs in sync with the implementation and gives a single place (this file) to track required edits.
