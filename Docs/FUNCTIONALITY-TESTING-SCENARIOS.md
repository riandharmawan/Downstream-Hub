# Downstream Hub — Comprehensive Functionality Testing Scenarios (PRD-Based)

This document provides **executable test scenarios** for unit, integration, and end-to-end (E2E) testing, aligned with the PRD and [TEST-PLAN.md](TEST-PLAN.md). Use it to run automated tests and to perform manual E2E verification.

---

## Scope (from PRD)

| Area | Features under test |
|------|---------------------|
| **Identity** | Register, login, allowed domain, confirm password, BU at registration, first user = Admin |
| **Domain whitelist** | Admin CRUD allowed domains; registration blocked for non-whitelisted domain |
| **Business units** | Admin CRUD BUs; assign user BU; assign app to BU or Global; dashboard filtered by BU |
| **Discovery** | Grid of apps (BU + Global); clickable cards |
| **Admin Console** | Domains, Business Units, Users, Applications, Password policy; URL validation; delete confirmation |
| **SSO** | Token on click; token not in URL; bridge POSTs token to target app; 60s TTL |
| **Audit** | Admin CRUD, login, password change, unlock; sso_access_logs |
| **Password expiry** | Policy (days); login 403 when expired; change-password-expired; in-app change password |
| **Security policy** | Complexity (length, upper/lower/number/symbol), password history (no reuse), lockout (N attempts; Admin unlock) |
| **Soft delete** | Delete sets deleted_at; all reads exclude soft-deleted |

---

## How to Run Tests

### Automated — Backend integration tests

```bash
cd backend
npm install
npm test
```

- **Without `DATABASE_URL`:** Health and auth validation tests run; DB-dependent tests are **skipped**.
- **With database:** Set `DATABASE_URL` (e.g. same as `.env` or a test DB). All integration tests run, including security policy (complexity, lockout, unlock, reuse).

See [RUNNING-AUTOMATED-TESTS.md](RUNNING-AUTOMATED-TESTS.md) for details.

### Manual — E2E

1. Start the app (e.g. `start.bat` or `docker compose up`).
2. Follow the **E2E scenarios** below in the browser (frontend http://localhost:3000, API http://localhost:4000).

### Unit tests

The project currently has **integration tests** in `backend/src/__tests__/integration/api.integration.test.js`. Unit tests for data layer and frontend components can be added per TEST-PLAN §2; the **unit scenarios** below define expected behaviour for future implementation.

---

## 1. Unit test scenarios

*Single modules or functions in isolation; mock DB/fetch where needed.*

### 1.1 Backend — Data access

| ID | Module | Scenario | Input / action | Expected |
|----|--------|----------|----------------|----------|
| U-B-1 | usersDb.getByEmail | User exists (active) | db, "user@allowed.com" | Row with id, email, password_hash, role, business_unit_id, password_changed_at, failed_login_attempts, locked_until |
| U-B-2 | usersDb.getByEmail | Not found or soft-deleted | db, "missing@x.com" | null |
| U-B-3 | usersDb.create | Insert with optional BU | db, { email, password_hash, role, business_unit_id } | Row with id, email, role, business_unit_id |
| U-B-4 | usersDb.updatePassword | Update hash and password_changed_at | db, userId, newHash | User row updated |
| U-B-5 | usersDb.incrementFailedLogin / resetFailedLogin / unlockUser | Lockout helpers | db, userId, policy | failed_login_attempts / locked_until updated as specified |
| U-B-6 | allowedDomainsDb.getByDomain / list | Active only | db | Row or list excluding deleted_at |
| U-B-7 | businessUnitsDb.list / getById | Active only | db | Exclude soft-deleted |
| U-B-8 | applicationsDb.listActive | Filter by BU | db, buId | target_bu_id IS NULL OR target_bu_id = buId |
| U-B-9 | passwordPolicyDb.get | Full policy | db | password_expiry_days, min_password_length, require_*, password_history_count, max_login_attempts, lockout_duration_mins |
| U-B-10 | passwordPolicyDb.update | Partial update, ranges | db, payload | Only provided keys updated; days 0–365, length 6–128, history 0–24, attempts 1–10, lockout 1–1440 |
| U-B-11 | passwordHistoryDb | getHashesForUser, add, trimToLimit | db, userId, limit | Correct hashes; trim keeps last N |

### 1.2 Backend — Validation

| ID | Area | Scenario | Input | Expected |
|----|------|----------|-------|----------|
| U-B-12 | passwordValidation | validatePassword weak (no symbol) | password, policy { require_symbol: true } | { valid: false, error } |
| U-B-13 | passwordValidation | validatePassword strong | "Pass1!word", policy | { valid: true } |
| U-B-14 | Auth route | Email format | Invalid email | 400 Invalid email format |
| U-B-15 | Applications route | URL validation | Invalid target_url | 400 valid http(s) URL |

### 1.3 Frontend — Components (for future unit tests)

| ID | Component | Scenario | Action | Expected |
|----|------------|----------|--------|----------|
| U-F-1 | Register form | Password ≠ confirm | Submit | Error "Password and confirm password do not match" |
| U-F-2 | Register form | Password length < 6 | Submit | Error min length |
| U-F-3 | apiRequest | 400 + JSON body | fetch returns 400 | Thrown object has status, error, code (if present) |
| U-F-4 | Login | 423 ACCOUNT_LOCKED | API returns 423 | "Account locked" message shown |

---

## 2. Integration test scenarios

*API endpoints with real or test DB; full request/response. Implemented in `backend/src/__tests__/integration/api.integration.test.js`.*

### 2.1 Health & auth (validation)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-1 | GET /health | GET /health | 200; { status: 'ok', service: 'downstream-hub-api' } |
| I-2 | Register — missing email/password | POST /api/auth/register without email or password | 400; "email and password required" |
| I-3 | Register — password ≠ password_retype | POST with different password_retype | 400; "confirm password do not match" |
| I-4 | Register — invalid email format | POST with invalid email | 400; "invalid email format" |
| I-5 | Register — password length < 6 | POST password "12345" | 400 (or 500 if DB unavailable) |
| I-6 | Login — missing credentials | POST /api/auth/login {} | 400; "email and password required" |
| I-7 | GET /api/auth/me — no token | No Authorization | 401 |

### 2.2 Auth with DB (when DATABASE_URL set)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-8 | GET registration-options | GET /api/auth/registration-options | 200; { business_units } array |
| I-9 | Register — domain not allowed | POST register with domain not in allowed_domains | 400 "domain not authorized" |

### 2.3 Protected & Admin-only routes

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-10 | GET password-policy — no token | GET /api/settings/password-policy | 401 |
| I-11 | PUT password-policy — no token | PUT /api/settings/password-policy | 401 |
| I-12 | GET /api/sso/redirect — no auth | GET with no token | 401 |
| I-13 | GET /api/sso/bridge — no ref | GET /api/sso/bridge | 400 |
| I-14 | GET applications/for-me — no token | GET /api/applications/for-me | 401 |
| I-15 | GET allowed-domains — no token | GET /api/allowed-domains | 401 |
| I-16 | GET business-units — no token | GET /api/business-units | 401 |
| I-17 | GET users — no token | GET /api/users | 401 |

### 2.4 Security policy (when DATABASE_URL set)

| ID | Scenario | Request | Expected |
|----|----------|---------|----------|
| I-18 | Register — complexity: weak password rejected | Policy requires symbol; register with password without symbol | 400; error matches complexity |
| I-19 | Register — complexity: strong password accepted | Register with compliant password | 201; token |
| I-20 | Change-password — reuse rejected | Change to A, then B, then try A again (history 2) | 400 "Cannot reuse a recent password" |
| I-21 | Login — lockout after N failures | Wrong password N times (max_attempts 2) | 423; code ACCOUNT_LOCKED; locked_until |
| I-22 | Login — correct password when locked | After lockout, login with correct password | 423 ACCOUNT_LOCKED |
| I-23 | POST unlock — then login succeeds | Admin POST /api/users/:id/unlock; user logs in | 200; token |
| I-24 | Login — success resets failed attempts | Fail 2x, success, then fail 3x again | First success 200; then 423 after 3 fails |

---

## 3. End-to-end (E2E) scenarios

*Full user journeys in the browser. Run manually or automate with Playwright/Cypress.*

### 3.1 Identity (User Story 1)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-1 | Register — success | /register → email (allowed domain), password, confirm, optional BU → Submit | Redirect to /; Dashboard; user in header |
| E-2 | Register — password mismatch | password ≠ confirm → Submit | Error; stay on register |
| E-3 | Register — domain not allowed | Email @ non-whitelisted domain → Submit | Error "Email domain not authorized." |
| E-4 | Login — success | /login → valid email/password → Submit | Redirect to /; Dashboard |
| E-5 | Login — invalid credentials | Wrong password → Submit | Error; stay on login |
| E-6 | Login — expired password | Login as expired user (policy > 0) | Redirect to /change-password-expired; email prefilled |
| E-7 | Change password (expired) | /change-password-expired → current, new, confirm → Submit | Success; redirect to Dashboard or Login |
| E-8 | Change password (logged-in) | Dashboard → Change password → current, new, confirm → Submit | "Password updated successfully."; can sign in with new password |

### 3.2 Security policy (lockout & unlock)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-9 | Login — account locked | Wrong password N times (N = max_login_attempts) | Message "Account locked" (or similar); 423 |
| E-10 | Admin — unlock user | Admin → Users → find locked user → Unlock | Status no longer "Locked"; user can log in |
| E-11 | Change password — reuse rejected | Set history 2; change to A, B, then try A again | Error "Cannot reuse a recent password" |

### 3.3 Domain whitelist (User Story 2)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-12 | Admin — add domain | Admin → Domains → Add domain → Save | Domain in table |
| E-13 | Admin — delete domain (not last) | Delete one of several → Confirm | Domain removed |
| E-14 | Admin — cannot delete last domain | Only one domain → Delete → Confirm | Error about last domain |

### 3.4 Business units (User Story 3)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-15 | Admin — create BU | Admin → Business Units → Add → Name → Save | BU in table |
| E-16 | Admin — assign user BU | Admin → Users → Edit BU → Select BU → Save | User row shows BU name |
| E-17 | Dashboard shows BU | Login as user with BU → Dashboard | Header shows "BU: &lt;name&gt;" |

### 3.5 Discovery & Admin (User Stories 4 & 5)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-18 | Grid filtered by BU | Admin: app with Target BU = X; login as user in X | Dashboard shows that app + Global apps |
| E-19 | Other BU user | Login as user in different BU | Only Global apps (no BU-specific) |
| E-20 | /admin redirect | Login Admin → /admin | Redirect to /admin/domains |
| E-21 | Sidebar sections | Click Domains, Business Units, Users, Applications, Password policy | Each URL and content correct; active highlighted |
| E-22 | Employee cannot access Admin | Login Employee → /admin/domains | "Admin access required" or redirect |
| E-23 | Admin — create application | Admin → Applications → Add → Name, URL, optional BU → Save | App in table |
| E-24 | Admin — delete application | Applications → Delete → Confirm | Confirm modal; app removed |
| E-25 | Admin — Password policy | Admin → Password policy → Set expiry, complexity, history, lockout → Save | Values persist; reload shows same |

### 3.6 SSO (User Story 6)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-26 | SSO — no token in URL | Dashboard → click app → observe URL | bridgeUrl has ref= only; no token= in query |
| E-27 | SSO — bridge form | Open bridge URL; inspect form | Form POSTs to target; token in body |

### 3.7 Audit

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| E-28 | Audit — login | Login → DB: audit_logs | LOGIN row |
| E-29 | Audit — Admin update | Admin updates BU → DB: audit_logs | UPDATE row with payload |
| E-30 | SSO access log | Click app → DB: sso_access_logs | New row user_id, application_id, outcome |

---

## 4. Traceability (PRD → scenarios)

| PRD area | Unit | Integration | E2E |
|----------|------|-------------|-----|
| Identity | U-B-1..5, U-F-1..4 | I-1..9 | E-1..8 |
| Security policy | U-B-9..11, U-B-12..13 | I-18..24 | E-9..11, E-25 |
| Domain whitelist | U-B-6..7 | (I-9) | E-12..14 |
| Business units | U-B-7..8 | (with DB) | E-15..17 |
| Discovery & Admin | U-B-8, U-B-15 | I-10..17 | E-18..25 |
| SSO | — | I-12..13 | E-26..27 |
| Audit | — | (with DB) | E-28..30 |

---

## 5. Running the comprehensive test suite (summary)

1. **Backend integration (automated)**  
   `cd backend && npm test`  
   - With `DATABASE_URL`: full run including security policy and DB-dependent auth.  
   - Without: health + auth validation only; DB tests skipped.

2. **Manual E2E**  
   Start app (e.g. `start.bat`), then execute scenarios in §3 in order (Identity → Security policy → Domains → BUs → Discovery/Admin → SSO → Audit).

3. **Unit tests**  
   Not yet implemented; scenarios in §1 define expected behaviour for future Jest (backend) and React Testing Library (frontend) tests.

For the full test plan and IDs, see [TEST-PLAN.md](TEST-PLAN.md). For step-by-step manual verification, see [TESTING.md](../TESTING.md).
