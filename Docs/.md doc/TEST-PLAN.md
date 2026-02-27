# Downstream Hub — Comprehensive Test Plan (PRD-Based)

This document defines **unit**, **integration**, and **end-to-end (E2E)** test scenarios aligned with the PRD, User Stories, and in-scope features. Use it to implement automated tests (e.g. Jest, Supertest, Playwright) or to run manual test passes.

---

## 1. PRD / User Story Mapping

| PRD Area | User Story | Test Focus |
|----------|------------|------------|
| **Identity** | Register and log in with company email; allowed domain; redirect to Grid. | Auth: register, login, domain check, confirm password, BU at registration. |
| **Domain whitelist** | Admin CRUD for Allowed Domains; registration blocked for non-whitelisted domain. | Allowed domains API; registration rejects unauthorized domain. |
| **Business units** | Admin CRUD for BUs; assign user BU; assign app to BU or Global. | BUs API; Users BU assignment; Applications target_bu_id; dashboard filtering. |
| **Discovery** | Grid of apps filtered by my BU or Global; clickable cards. | GET /api/applications/for-me; dashboard UI; BU in header. |
| **Admin Console** | Manage applications (Name, Icon, Description, Link, Target BU); URL validation; delete confirmation. | Applications CRUD; Admin-only routes; sidebar; Password policy. |
| **SSO Hand-off** | Token generated on click; token not in URL; target app validates 60s TTL. | SSO redirect; bridge page; token in body; sso_access_logs. |
| **Audit** | Admin CRUD and SSO logged; append-only. | audit_logs for CREATE/UPDATE/DELETE/LOGIN/PASSWORD_CHANGE; sso_access_logs. |
| **Password expiry** | Admins set expiry; expired users change password before sign-in. | Password policy API; login 403 PASSWORD_EXPIRED; change-password-expired; change-password. |
| **Soft delete** | Delete sets deleted_at; reads exclude soft-deleted. | All list/get exclude deleted_at; delete is UPDATE. |

---

## 2. Unit Tests

*Scope: Single modules or functions in isolation; mock dependencies (DB, fetch) where needed.*

### 2.1 Backend — Data access layer

| ID | Module | Scenario | Input / Action | Expected |
|----|--------|----------|----------------|----------|
| U-B-1 | **usersDb.getByEmail** | Returns user when email exists (active only) | db, "user@allowed.com" | Row with id, email, password_hash, role, business_unit_id, password_changed_at |
| U-B-2 | **usersDb.getByEmail** | Returns null when email not found or soft-deleted | db, "missing@x.com" | null |
| U-B-3 | **usersDb.create** | Inserts user with optional business_unit_id and sets password_changed_at | db, { email, password_hash, role, business_unit_id } | Returned row has id, email, role, business_unit_id |
| U-B-4 | **usersDb.updatePassword** | Updates password_hash and sets password_changed_at to now() | db, userId, newHash | User row updated |
| U-B-5 | **usersDb.getByIdWithBuName** | Returns user with business_unit_name when BU set | db, userId | Row includes business_unit_name |
| U-B-6 | **allowedDomainsDb.getByDomain** | Returns domain row when active | db, "example.com" | Row or null |
| U-B-7 | **allowedDomainsDb.list** | Excludes soft-deleted | db | Rows where deleted_at IS NULL |
| U-B-8 | **businessUnitsDb.list** | Excludes soft-deleted, ordered by name | db | Rows where deleted_at IS NULL |
| U-B-9 | **businessUnitsDb.getById** | Returns null for soft-deleted BU | db, deletedBuId | null |
| U-B-10 | **applicationsDb.listActive** | Returns apps where target_bu_id IS NULL OR target_bu_id = buId | db, buId | Only Global + BU-specific apps |
| U-B-11 | **passwordPolicyDb.get** | Returns { password_expiry_days } | db | Object with password_expiry_days (0–365) |
| U-B-12 | **passwordPolicyDb.update** | Clamps days to 0–365 and updates row | db, { password_expiry_days: 400 } | Stored as 365 |

### 2.2 Backend — Validation / helpers

| ID | Area | Scenario | Input | Expected |
|----|------|----------|-------|----------|
| U-B-13 | **Auth route** | Email format validation | Invalid email string | 400 Invalid email format |
| U-B-14 | **Auth route** | Password length &lt; 6 | password length 5 | 400 Password must be at least 6 characters |
| U-B-15 | **Applications route** | URL validation (validateAppBody) | Invalid target_url | { error: "Target URL must be a valid http(s) URL" } |
| U-B-16 | **Applications route** | target_bu_id null vs UUID | target_bu_id "" or null | Normalized to null |

### 2.3 Frontend — Components / logic

| ID | Component / Area | Scenario | Action | Expected |
|----|-------------------|----------|--------|----------|
| U-F-1 | **Register form** | Client-side password match | password ≠ passwordRetype, submit | Error "Password and confirm password do not match" |
| U-F-2 | **Register form** | Min length 6 | password length 5, submit | Error "Password must be at least 6 characters" |
| U-F-3 | **apiRequest** | Throws on !res.ok with body | fetch returns 400 + JSON | Thrown object has status, error, code (if present) |
| U-F-4 | **AuthContext** | setSession updates token and user | setSession(token, user) | localStorage and state updated |
| U-F-5 | **ChangePasswordExpired** | Prefills email from location.state | Navigate with state.email | email input shows state value |

---

## 3. Integration Tests

*Scope: API endpoints with real or test DB; auth middleware; full request/response.*

### 3.1 Auth (User Story 1 — Identity)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-1 | **POST /api/auth/register** — missing email or password | Body without email or password | 400 Email and password required |
| I-2 | **POST /api/auth/register** — password ≠ password_retype | Same body, different retype | 400 Password and confirm password do not match |
| I-3 | **POST /api/auth/register** — domain not allowed | Email with domain not in allowed_domains | 400 Email domain not authorized. |
| I-4 | **POST /api/auth/register** — success, first user | Valid body, no users in DB | 201; user.role = Admin; token |
| I-5 | **POST /api/auth/register** — success, second user | Valid body, one user exists | 201; user.role = Employee; token; user.business_unit_id if sent |
| I-6 | **POST /api/auth/register** — invalid business_unit_id | Valid body, fake UUID for BU | 400 Invalid business unit |
| I-7 | **POST /api/auth/register** — duplicate email | Same email twice | 409 Email already registered |
| I-8 | **GET /api/auth/registration-options** | No auth | 200; { business_units } array |
| I-9 | **POST /api/auth/login** — invalid credentials | Wrong password | 401 Invalid email or password |
| I-10 | **POST /api/auth/login** — success | Correct email/password | 200; user (id, email, role, business_unit_id); token |
| I-11 | **POST /api/auth/login** — password expired | Correct credentials, policy &gt; 0, user expired | 403; error "Password expired"; code "PASSWORD_EXPIRED" |
| I-12 | **GET /api/auth/me** — no token | No Authorization header | 401 Authentication required |
| I-13 | **GET /api/auth/me** — valid token | Bearer &lt;token&gt; | 200; user with business_unit_id, business_unit_name |

### 3.2 Password expiry

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-14 | **POST /api/auth/change-password-expired** — wrong current password | email, wrong current_password, new, retype | 401 Invalid email or current password |
| I-15 | **POST /api/auth/change-password-expired** — new ≠ retype | new_password ≠ new_password_retype | 400 New password and confirm do not match |
| I-16 | **POST /api/auth/change-password-expired** — success (expired user) | Valid body, user actually expired | 200; message; token; user |
| I-17 | **POST /api/auth/change-password** — unauthenticated | No token | 401 |
| I-18 | **POST /api/auth/change-password** — wrong current password | Valid token, wrong current_password | 401 Current password is incorrect |
| I-19 | **POST /api/auth/change-password** — success | Valid token, correct current, new, retype | 200; message "Password updated" |
| I-20 | **GET /api/settings/password-policy** — no auth | No token | 401 |
| I-21 | **GET /api/settings/password-policy** — Employee token | Bearer employee-token | 403 Admin access required |
| I-22 | **GET /api/settings/password-policy** — Admin | Bearer admin-token | 200; { password_expiry_days } |
| I-23 | **PUT /api/settings/password-policy** — Admin, valid | Body { password_expiry_days: 90 } | 200; { password_expiry_days: 90 } |
| I-24 | **PUT /api/settings/password-policy** — out of range | password_expiry_days &lt; 0 or &gt; 365 | 400 |

### 3.3 Domain whitelist (User Story 2)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-25 | **GET /api/allowed-domains** — Admin | Bearer admin-token | 200; allowed_domains array |
| I-26 | **GET /api/allowed-domains** — Employee | Bearer employee-token | 403 |
| I-27 | **POST /api/allowed-domains** — valid domain | Body { domain: "new.com" } (Admin) | 201; row |
| I-28 | **DELETE /api/allowed-domains/:id** — last domain | Only one domain left | 400 Cannot delete the last allowed domain |
| I-29 | **DELETE /api/allowed-domains/:id** — soft delete | Admin, valid id | 204; row soft-deleted; list no longer returns it |

### 3.4 Business units (User Story 3)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-30 | **GET /api/business-units** — Admin | Bearer admin-token | 200; business_units (no soft-deleted) |
| I-31 | **POST /api/business-units** — create | Body { name: "Sales" } (Admin) | 201; row |
| I-32 | **PUT /api/business-units/:id** — update name | Admin | 200; updated row |
| I-33 | **DELETE /api/business-units/:id** — soft delete | Admin | 204; list excludes it |

### 3.5 Users (BU assignment)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-34 | **GET /api/users** — Admin | Bearer admin-token | 200; users with business_unit_id, business_unit_name |
| I-35 | **PATCH /api/users/:id** — set BU | Body { business_unit_id: buId } (Admin) | 200; user updated |
| I-36 | **PATCH /api/users/:id** — set BU to null | Body { business_unit_id: null } | 200 |
| I-37 | **PATCH /api/users/:id** — invalid BU UUID | business_unit_id = non-existent | 400 Business unit not found |

### 3.6 Applications & discovery (User Stories 4 & 5)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-38 | **GET /api/applications/for-me** — authenticated | Bearer token (user with BU) | 200; applications = Global + user's BU only |
| I-39 | **GET /api/applications/for-me** — user no BU | Bearer token (user.business_unit_id null) | 200; only Global apps |
| I-40 | **GET /api/applications** — Admin, full list | Bearer admin-token | 200; all apps with target_bu_name |
| I-41 | **POST /api/applications** — valid body | Name, target_url, optional target_bu_id (Admin) | 201; app created |
| I-42 | **POST /api/applications** — invalid URL | target_url not http(s) | 400 |
| I-43 | **PUT /api/applications/:id** — update | Admin | 200; updated app |
| I-44 | **DELETE /api/applications/:id** — soft delete | Admin | 204; for-me no longer returns it |

### 3.7 SSO (User Story 6)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-45 | **GET /api/sso/redirect** — no applicationId | Query without applicationId | 400 applicationId required |
| I-46 | **GET /api/sso/redirect** — invalid app id | applicationId = fake UUID | 404 Application not found |
| I-47 | **GET /api/sso/redirect** — success | Valid app id, Bearer token | 200; bridgeUrl; URL has ref=, no token= in query |
| I-48 | **GET /api/sso/bridge** — no ref | No query ref | 400 Missing ref |
| I-49 | **GET /api/sso/bridge** — invalid/expired ref | Bad or expired ref | 400 Invalid or expired link |

### 3.8 Audit & soft delete

| ID | Scenario | Action | Expected |
|----|----------|--------|----------|
| I-50 | **Audit — login** | POST /api/auth/login success | audit_logs has LOGIN row |
| I-51 | **Audit — Admin CRUD** | Create application (Admin) | audit_logs has CREATE, target_entity, payload_after |
| I-52 | **Audit — password change** | POST /api/auth/change-password success | audit_logs has PASSWORD_CHANGE |
| I-53 | **Audit — password policy** | PUT /api/settings/password-policy | audit_logs has UPDATE, password_policy |
| I-54 | **SSO access log** | GET /api/sso/redirect success | sso_access_logs has user_id, application_id, outcome |
| I-55 | **Soft delete — list** | Soft-delete a domain, then GET /api/allowed-domains | Deleted domain not in list |
| I-56 | **Soft delete — get** | GET /api/applications/:id for soft-deleted id | 404 (or not returned) |

---

## 4. End-to-End (E2E) Tests

*Scope: Full user journeys in the browser (e.g. Playwright, Cypress); real or seeded DB.*

### 4.1 Identity (User Story 1)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-1 | **Register — success, redirect to Dashboard** | Open /register → fill email (allowed domain), password, confirm, optional BU → Submit | Redirect to /; Dashboard visible; user email in header |
| E-2 | **Register — password mismatch** | Different password vs confirm → Submit | Error shown; stay on register |
| E-3 | **Register — domain not allowed** | Email with domain not in whitelist → Submit | Error "Email domain not authorized." |
| E-4 | **Login — success** | Open /login → valid email/password → Submit | Redirect to /; Dashboard |
| E-5 | **Login — invalid credentials** | Wrong password → Submit | Error; stay on login |
| E-6 | **Login — expired password redirect** | Login as user with expired password (policy &gt; 0) | Redirect to /change-password-expired; email prefilled |
| E-7 | **Change password (expired) — full flow** | On /change-password-expired → current + new + confirm → Submit | Success; redirect to Dashboard (or Login with message) |
| E-8 | **Change password (logged-in)** | Dashboard → Change password → current + new + confirm → Submit | "Password updated successfully."; can sign in with new password |

### 4.2 Domain whitelist (User Story 2)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-9 | **Admin — add domain** | Login as Admin → Admin → Domains → Add domain → "test.com" → Save | Domain appears in table |
| E-10 | **Admin — delete domain (not last)** | Delete one of several domains → Confirm | Domain removed from list |
| E-11 | **Admin — cannot delete last domain** | Only one domain → Delete → Confirm | Error about last domain |

### 4.3 Business units (User Story 3)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-12 | **Admin — create BU** | Admin → Business Units → Add → "Engineering" → Save | BU in table |
| E-13 | **Admin — assign user BU** | Admin → Users → Edit BU for a user → Select BU → Save | User row shows BU name |
| E-14 | **Dashboard shows user BU** | Login as user with BU → Dashboard | Header shows "BU: &lt;name&gt;" |

### 4.4 Discovery (User Story 4)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-15 | **Grid filtered by BU** | Admin: create app with Target BU = "Engineering"; login as Engineering user | Dashboard shows that app + Global apps |
| E-16 | **Other BU user does not see BU-specific app** | Login as user in different BU (or no BU) | Only Global apps visible |
| E-17 | **Click app card** | Click an app on Dashboard | Redirect to bridge then to target URL (or error if target unreachable) |

### 4.5 Admin Console (User Story 5)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-18 | **/admin redirects to /admin/domains** | Login Admin → navigate to /admin | URL becomes /admin/domains; Domains content |
| E-19 | **Sidebar — all sections** | Admin → click Domains, Business Units, Users, Applications, Password policy | Each URL and content correct; active highlighted |
| E-20 | **Employee cannot access Admin** | Login as Employee → open /admin/domains | "Admin access required" (or redirect) |
| E-21 | **Admin — create application** | Admin → Applications → Add application → Name, Target URL, optional Target BU → Save | App in table |
| E-22 | **Admin — delete application — confirmation** | Applications → Delete → Modal | Confirm modal; after confirm, app removed from list |
| E-23 | **Admin — Password policy** | Admin → Password policy → Set "Password expires after" 90 → Save | Value persists; GET /api/settings/password-policy returns 90 |

### 4.6 SSO (User Story 6)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-24 | **SSO — bridge URL has no token in address bar** | Dashboard → click app → observe URL after redirect | bridgeUrl has ref= only; no token= in query |
| E-25 | **SSO — bridge form POST** | Open bridge URL (or follow click); inspect form | Form POSTs to target; hidden input token in body |

### 4.7 Audit & security

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-26 | **Audit — login recorded** | Login → DB: SELECT * FROM audit_logs WHERE action_type = 'LOGIN' ORDER BY created_at DESC LIMIT 1 | Row exists |
| E-27 | **Audit — Admin update recorded** | Admin updates a BU name → DB: check audit_logs | UPDATE row with payload_before, payload_after |
| E-28 | **SSO access log** | Click app from Dashboard → DB: sso_access_logs | New row user_id, application_id, outcome |

---

## 5. Test Implementation Notes

### 5.1 Unit tests (suggested stack)

- **Backend:** Jest; mock `pool` or use a test DB connection; test each `*Db.js` function and route-level validation helpers.
- **Frontend:** React Testing Library + Jest; mock `apiRequest` and `useAuth`; test Register/Login/ChangePassword form validation and error display.

### 5.2 Integration tests (suggested stack)

- **Backend:** Jest + Supertest; run against a test database (migrations applied, optional seed); no UI. Cover all API routes in §3; assert status, body, and optionally DB state (e.g. audit_logs, sso_access_logs).

### 5.3 E2E tests (suggested stack)

- **Playwright or Cypress;** one browser; start app (or use deployed test env); seed DB with allowed domain + Admin user (and optionally one Employee, one BU, one app). Run scenarios in §4; prefer data-testid or stable selectors for buttons/forms.

### 5.4 Environment

- **Unit:** No DB required for pure logic; mock DB for data layer.
- **Integration:** `DATABASE_URL` for a dedicated test DB; run migrations; truncate or seed between suites as needed.
- **E2E:** Full stack (frontend + API + DB); optional Docker Compose for test env.

### 5.5 Coverage goals (suggested)

- **Unit:** Critical paths in usersDb, passwordPolicyDb, allowedDomainsDb, applicationsDb.listActive; auth validation; Register/Login client validation.
- **Integration:** All auth endpoints; password expiry endpoints; settings password-policy; domains, BUs, users, applications CRUD; for-me filtering; SSO redirect/bridge; audit and sso_access_logs.
- **E2E:** At least one happy path per User Story (register→login→dashboard; Admin CRUD domains/BUs/apps; password expired→change→login; SSO click).

---

## 6. Traceability Summary

| User Story | Unit | Integration | E2E |
|------------|------|--------------|-----|
| 1 Identity | U-B-1..4, U-F-1..2 | I-1..13, I-14..24 | E-1..8 |
| 2 Domain whitelist | U-B-6..7 | I-25..29 | E-9..11 |
| 3 Business units | U-B-8..9 | I-30..33, I-34..37 | E-12..14 |
| 4 Discovery | U-B-10 | I-38..39 | E-15..17 |
| 5 Admin Console | U-B-15..16 | I-40..44, I-20..24 | E-18..23 |
| 6 SSO | — | I-45..49, I-54 | E-24..25 |
| Audit / Soft delete | U-B-7..9 | I-50..56 | E-26..28 |
| Password expiry | U-B-4, U-B-11..12, U-F-4..5 | I-11, I-14..24 | E-6..8, E-23 |

This plan ensures PRD scope is covered by unit, integration, and E2E scenarios and can be used to implement and track tests over time.
