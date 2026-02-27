# Plan: Admin User Features (Manual creation, Deactivation, Password reset)

This document reassesses the new PRD capability and outlines the implementation plan **before** execution.

**Source:** PRD update — *Added Admin features: Manual user creation, User deactivation, and Password reset.*  
*(The PRD .docx could not be read in this environment; if your doc has extra constraints—e.g. “force change on next login”, “reactivate”—paste the relevant excerpt and we can align.)*

---

## 1. Reassessment: What Exists Today

| Area | Current state |
|------|----------------|
| **Users API** | `GET /api/users` (list with BU), `PATCH /api/users/:id` (update `business_unit_id` only). Admin-only. |
| **Users DB** | `create`, `getById`, `getByEmail`, `updatePassword`, `updateBusinessUnit`, `softDelete`. All reads exclude `deleted_at`. |
| **Auth** | Register (self-service, allowed-domain check); login uses `getByEmail` (so soft-deleted users cannot log in). |
| **Admin UI** | Users section: table (email, role, BU) + “Edit BU” only. No create user, no deactivate, no reset password. |

So: **manual user creation**, **user deactivation**, and **admin password reset** are not yet exposed in API or UI; the data layer already supports create, soft delete, and password update.

---

## 2. Scope of the New Capability

| Feature | Brief description | Intended behavior |
|---------|--------------------|-------------------|
| **Manual user creation** | Admin creates a user without self-registration. | Admin provides email, password (and confirm), role (Admin/Employee), optional BU. Email must belong to an allowed domain. New user can log in immediately. |
| **User deactivation** | Admin disables a user so they can no longer log in. | Use existing soft delete (`deleted_at`). Deactivated user disappears from list and cannot log in. Optional later: “Reactivate” (clear `deleted_at`). |
| **Password reset** | Admin sets a new password for a user. | Admin provides new password (and confirm). User’s password is updated; optionally “force change on next login” (e.g. set `password_changed_at` to past so expiry policy forces change). |

---

## 3. Implementation Plan (Order of Execution)

### Phase 1 — Backend API

1. **Manual user creation (Admin)**  
   - **Route:** `POST /api/users` (Admin only).  
   - **Body:** `email`, `password`, `password_retype`, `role` (Admin | Employee), optional `business_unit_id`.  
   - **Validation:** Same as register: required email/password, match retype, valid email format, length ≥ 6, domain in `allowed_domains`, valid BU if provided.  
   - **Logic:** Determine role explicitly from body (no “first user = Admin”); hash password; `usersDb.create`; audit log CREATE user; return 201 + user (no token).  
   - **Files:** `backend/src/routes/users.js` (add POST), reuse `allowedDomainsDb.getByDomain`, `businessUnitsDb.getById`, `usersDb.create`, `auditLog`.

2. **User deactivation (Admin)**  
   - **Route:** `POST /api/users/:id/deactivate` (Admin only).  
   - **Logic:** Ensure user exists and is not already soft-deleted; `usersDb.softDelete(pool, id)`; audit log (e.g. action_type `DEACTIVATE` or `DELETE`, target_entity `user:email`).  
   - **Optional:** `POST /api/users/:id/reactivate` to clear `deleted_at` (requires a small DB helper).  
   - **Files:** `backend/src/routes/users.js`, `backend/src/db/usersDb.js` (already has `softDelete`; add `reactivate` if needed).

3. **Password reset (Admin)**  
   - **Route:** `POST /api/users/:id/reset-password` (Admin only).  
   - **Body:** `new_password`, `new_password_retype`.  
   - **Validation:** Both present, match, length ≥ 6.  
   - **Logic:** Load user by id; if not found or soft-deleted return 404; hash new password; `usersDb.updatePassword`; audit log PASSWORD_RESET (or UPDATE user).  
   - **Optional:** Set `password_changed_at` to a past date so password-expiry policy forces change on next login (if product wants “force change on next login”).  
   - **Files:** `backend/src/routes/users.js`, `usersDb.updatePassword`.

4. **List users: include deactivated (optional)**  
   - Today list excludes soft-deleted. Decision: either keep “active only” in list and add a toggle “Show deactivated”, or add a query `?include_deactivated=true` and a small `usersDb.listWithBu(..., includeDeactivated)`. Defer to Phase 2 if needed; initial delivery can be “deactivated users simply disappear from list”.

### Phase 2 — Frontend (Admin Users section)

5. **Manual user creation**  
   - “Add user” button; modal or inline form: Email, Password, Confirm password, Role (dropdown: Admin / Employee), Business unit (dropdown, optional).  
   - Submit → `POST /api/users`; on success refresh user list and close form; on error show message (e.g. domain not allowed, email already registered).

6. **User deactivation**  
   - Per row: “Deactivate” button (only for active users). Confirm dialog: “Deactivate user …? They will not be able to log in.” Submit → `POST /api/users/:id/deactivate`; refresh list.  
   - If “reactivate” is implemented: show “Reactivate” for deactivated users when “Show deactivated” is on.

7. **Password reset**  
   - Per row: “Reset password” button. Modal: New password, Confirm new password. Submit → `POST /api/users/:id/reset-password`; success message; no token issued.

### Phase 3 — Consistency and Docs

8. **Auth/register vs manual create**  
   - Keep registration flow as-is (self-service, first user = Admin). Manual create is the only way an Admin can create another Admin without that user ever registering.

9. **Audit**  
   - Ensure audit_logs entries for: CREATE user (manual), DEACTIVATE user, PASSWORD_RESET (or UPDATE user with action_type that distinguishes reset).

10. **Testing and docs**  
    - Add integration tests (e.g. POST /api/users validation and 201; deactivate 404/200; reset-password validation and 200).  
    - Update TEST-PLAN.md / TESTING.md with new scenarios; optionally RUNNING-AUTOMATED-TESTS.md if E2E later covers Admin user management.

---

## 4. Decisions to Confirm (from PRD or product)

- **Manual create:** Must email domain be in allowed_domains? (Recommended: **yes**, for consistency.)  
- **Deactivation:** Is “reactivate” in scope for this release? (Can be added later without breaking anything.)  
- **Password reset:** Should we support “force change on next login” (e.g. set `password_changed_at` to past)? (Recommended: optional, configurable in API so UI can add a checkbox later.)  
- **List users:** Deactivated users are hidden from list; no "Show deactivated" in this phase. (Decisions confirmed: manual create with allowed domain; reactivate skipped; password reset = random 20-char, copy only, no email.)

---

## 5. Suggested Order of Execution

1. Backend: `POST /api/users` (manual create).  
2. Backend: `POST /api/users/:id/deactivate`.  
3. Backend: `POST /api/users/:id/reset-password`.  
4. Frontend: Add user form + “Add user” in Users section.  
5. Frontend: “Deactivate” (+ confirm) and “Reset password” (+ modal) in Users table.  
6. Optional: List deactivated users + Reactivate; integration tests; doc updates.

---

## 6. Summary

- **Reassessment:** No conflict with existing design. All three features fit the current auth and user model; DB already supports create, soft delete, and password update.  
- **Plan:** Implement backend routes first (manual create, deactivate, reset-password), then Admin UI (Add user, Deactivate, Reset password), then tests and docs.  
- **Next step:** Confirm the four decisions above (and any PRD excerpts you can paste), then execute in the order above.
