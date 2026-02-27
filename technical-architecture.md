# Downstream Hub — Technical Architecture

This document describes the system architecture, data model, SSO design, security, logging, and CI/CD for **Downstream Hub**, aligned with the [Downstream Hub Tech Spec](Docs/Downstream%20Hub%20Tech%20Spec.docx) (v3.2) and [PRD](Docs/Downstream%20Hub%20PRD.docx) (v3.2).

### Implementation Phases (Completed)

| Phase | Scope |
|-------|--------|
| **A** | Registration: BU dropdown and confirm password at sign-up; backend validates `password === password_retype` and optional `business_unit_id`; public `GET /api/auth/registration-options` returns active BUs for the registration form. |
| **B** | Session & UI: Login and register responses and `GET /api/auth/me` return `business_unit_id` and `business_unit_name`; dashboard header displays the user's Business Unit. |
| **C** | Admin polish: Applications admin section has title and description; four sub-routes (Domains, Business Units, Users, Applications) with sidebar; `/admin` redirects to `/admin/domains`. |
| **D** | SSO & audit: Bridge page (`GET /api/sso/bridge?ref=...`) POSTs token to target app (form body, not URL); all Admin CRUD, login, and user BU updates write to `audit_logs`; SSO attempts recorded in `sso_access_logs`. |

---

## 1. System Architecture

The application follows a **decoupled Client–Server** architecture to ensure scalability and ease of deployment across Alibaba Cloud (Alicloud) environments.

### 1.1 Components

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| **Frontend** | React.js (SPA) | Grid View (app discovery **filtered by BU/Global**), Admin Console with **sub-menus**: Domains, Business Units, Users, Applications (see §1.3). |
| **Backend** | Node.js / Express.js | REST API: authentication (**domain whitelist**), application metadata CRUD (**Target BU**, icon), **BU** and **Allowed Domains** CRUD, SSO token generation (**header-based**, not URL), **security policy enforcement** (password complexity, history, account lockout). |
| **Database** | PostgreSQL (Alibaba Cloud RDS) | Users (with **business_unit_id**), applications (with **target_bu_id**, icon_url), **allowed_domains**, **business_units**, audit_logs, **sso_access_logs**. |
| **Caching** | Redis (ApsaraDB) | Short-lived SSO session tokens to meet the **&lt; 200 ms** authentication latency target. |

### 1.2 High-Level Flow

```
[Browser] ←→ [React SPA] ←→ [Express API] ←→ [PostgreSQL]
                  ↑                ↑
                  |                +——— [Redis] (SSO tokens)
                  |
            [Bridge / Target Apps] (token in Authorization header, NOT in URL)
```

- Users authenticate with the Hub; registration is restricted to **allowed domains**.
- The frontend calls the Express API for auth and for the **filtered** app list (user’s BU or Global).
- On “open app,” the API generates a short-lived token. The token is delivered via **header** (e.g. bridge page POST with `Authorization: Bearer {token}`), **not** in the redirect URL.
- Downstream apps read the token from the request header, validate it (e.g. 60s TTL), and log the user in (SSO hand-off).

### 1.3 Admin Console (Sub-menus)

The Admin UI is split into four sub-routes, selected via a sidebar:

| Sub-menu        | Route                  | Purpose                                                                 |
|-----------------|------------------------|-------------------------------------------------------------------------|
| **Domains**     | `/admin/domains`       | CRUD for allowed email domains (registration whitelist).                |
| **Business Units** | `/admin/business-units` | CRUD for BUs (departments).                                          |
| **Users**       | `/admin/users`        | List users, assign/update each user’s Business Unit, **unlock locked accounts**.                 |
| **Applications** | `/admin/applications` | CRUD for applications (name, icon, description, target URL, Target BU). |
| **Security policy** | Admin → Security policy (Password policy section) | Set **password expiry**, **min length**, **complexity** (upper/lower/number/symbol), **password history count**, **max login attempts**, **lockout duration**. |

Visiting `/admin` redirects to `/admin/domains`. Only the selected section’s content is shown; the sidebar highlights the active sub-menu.

---

## 2. Environment & Infrastructure Strategy

Environment parity is maintained using **separate `.env` files** and **Alibaba Cloud Resource Groups**.

| Feature | Dev (Local) | Testing (Alibaba Cloud) | Production (Alibaba Cloud) |
|---------|-------------|--------------------------|-----------------------------|
| **Host** | `localhost:3000` | Alibaba Cloud ACK (Staging) | Alibaba Cloud ACK (Prod) |
| **Database** | Dockerized PostgreSQL | RDS (small instance) | RDS (high-availability) |
| **Config** | `.env.local` | `.env.testing` | `.env.production` |
| **Secrets** | Local shell / env | KMS (Key Management Service) | KMS (Key Management Service) |

- **Secrets** (DB URLs, SSO private keys, etc.) are injected via **Alibaba Cloud KMS** during the CI/CD build for Testing and Production.

---

## 3. Data Schema (Core Entities)

The following entities support the required User Stories (PRD v2.0 / Tech Spec v2.1).

### 3.1 Allowed Domains Table

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID | Primary key. |
| `domain` | String | Unique when active (partial unique: `WHERE deleted_at IS NULL`). e.g. `kpn-corp.com`. |
| `created_at` | Timestamp | Audit. |
| `deleted_at` | Timestamp (nullable) | Set on soft delete; see §3.7. |

- Registration is allowed only when the email domain (after `@`) exists in this table. Otherwise the API returns **"Email domain not authorized."**

### 3.2 Business Units Table

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID | Primary key. |
| `name` | String | Unique when active (partial unique: `WHERE deleted_at IS NULL`). |
| `created_at` | Timestamp | Audit. |
| `deleted_at` | Timestamp (nullable) | Set on soft delete; see §3.7. |

- Users and applications are linked to a BU via optional foreign keys. Applications with **NULL** target BU are **Global** (visible to all BUs).

### 3.3 Users Table

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID | Primary key. |
| `email` | String | Unique when active (partial unique: `WHERE deleted_at IS NULL`); used for login. |
| `password_hash` | String | Hashed password. |
| `role` | Enum | `Admin` \| `Employee`. |
| `business_unit_id` | UUID (nullable, FK → business_units) | User’s department; used to filter the dashboard app list. |
| `password_changed_at` | Timestamp (nullable) | When the password was last set; used for password expiry. |
| `failed_login_attempts` | INT NOT NULL DEFAULT 0 | Incremented on wrong password; reset on success or Admin unlock. |
| `locked_until` | Timestamptz (nullable) | When lockout ends; set when failed_login_attempts ≥ max_login_attempts; cleared by Admin unlock or after lockout_duration_mins. |
| `deleted_at` | Timestamp (nullable) | Set on soft delete; see §3.7. |

- **Admins** can access the Admin Console (app CRUD, Allowed Domains, Business Units, user BU assignment, **Password policy**); **Employees** only see the filtered Grid and use SSO.

### 3.3a Password Policy Table

| Column | Type | Notes |
|--------|------|------|
| `id` | INT (PK) | Single row (id = 1). |
| `password_expiry_days` | INT NOT NULL | 0 = disabled; &gt; 0 = user must change password within this many days of `password_changed_at`. |
| `min_password_length` | INT NOT NULL DEFAULT 6 | Minimum length (6–128). |
| `require_uppercase` / `require_lowercase` / `require_number` / `require_symbol` | BOOLEAN NOT NULL | When true, password must contain at least one of each. |
| `password_history_count` | INT NOT NULL DEFAULT 5 | 0 = disable reuse check; otherwise last N hashes stored; change-password rejects reuse. |
| `max_login_attempts` | INT NOT NULL DEFAULT 5 | After this many wrong logins, account is locked. |
| `lockout_duration_mins` | INT NOT NULL DEFAULT 30 | Lockout duration; Admin can unlock earlier. |
| `updated_at` | Timestamp | Last policy change. |

- **GET/PUT /api/settings/password-policy** (Admin only) read and update this row (all fields). Audit log records policy changes.

### 3.3b Password History Table (user_password_history)

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID (PK) | gen_random_uuid(). |
| `user_id` | UUID NOT NULL (FK → users) | User whose password was changed. |
| `password_hash` | VARCHAR(255) NOT NULL | Hash of a previous password. |
| `created_at` | Timestamptz NOT NULL | When that password was superseded. |

- Used to enforce **no reuse of last N passwords** on change-password (and change-password-expired). After each change, current hash is appended and rows are trimmed to last N per user (index on user_id, created_at DESC).

### 3.4 Applications Table

| Column | Type | Notes |
|--------|------|------|
| `id` | UUID | Primary key. |
| `name` | String | Display name. |
| `description` | Text | Short description for the grid. |
| `icon_url` | String (nullable) | URL for the app icon. |
| `target_url` | String | Validated URL format; base URL for the app (token is sent via **header**, not in URL). |
| `target_bu_id` | UUID (nullable, FK → business_units) | If **NULL**, app is **Global** (all BUs). Otherwise only users in that BU see it. |
| `deleted_at` | Timestamp (nullable) | Set on soft delete; see §3.7. |

### 3.5 Audit Logs Table

| Field | Description |
|-------|-------------|
| `actor_id` | UUID of the Admin who performed the action. |
| `action_type` | CREATE, UPDATE, DELETE, LOGIN, PASSWORD_CHANGE, **UNLOCK** (when Admin unlocks a user). |
| `target_entity` | Entity type and identifier (e.g. application, allowed_domain, business_unit, user). |
| `payload_before` | JSON snapshot before the change. |
| `payload_after` | JSON snapshot after the change. |
| `ip_address` | Origin IP. |

- **Append-only:** no DELETE (or UPDATE) permissions on this table.

### 3.6 SSO Access Logs Table

| Field | Description |
|-------|-------------|
| `user_id` | User who attempted SSO. |
| `application_id` | Target application. |
| `outcome` | Success or failure. |
| `created_at` | Timestamp. |
| `deleted_at` | Timestamp (nullable). Present for consistency; see §3.7. |

- Used for **Adoption Rate** and security monitoring.

### 3.7 Soft Delete

All core tables support **soft delete** via a nullable **`deleted_at`** (TIMESTAMPTZ) column:

| Table | Soft delete behavior |
|-------|------------------------|
| `users` | `deleted_at` set on “delete”; login and lists exclude soft-deleted. |
| `applications` | Admin “Delete” sets `deleted_at`; grid and CRUD exclude soft-deleted. |
| `allowed_domains` | Admin “Delete” sets `deleted_at`; registration domain check excludes soft-deleted. |
| `business_units` | Admin “Delete” sets `deleted_at`; lists and FK lookups exclude soft-deleted. |
| `sso_access_logs` | Column present for consistency; no delete in API. |

- **Uniques:** For tables with a unique business key (`users.email`, `allowed_domains.domain`, `business_units.name`), the schema uses **partial unique indexes** so the same value can be re-used after soft delete (e.g. `UNIQUE (domain) WHERE deleted_at IS NULL`).
- **Enforcement:** All reads and deletes go through a **data access layer** (`backend/src/db/*Db.js`). These modules always add `WHERE deleted_at IS NULL` (or equivalent) to list/get queries and implement “delete” as `UPDATE ... SET deleted_at = now()`. Routes do not issue raw `DELETE` or unfiltered `SELECT` for these tables, so soft-deleted rows are never returned by the API and developers cannot accidentally omit the filter.

---

## 4. Identity, Access Control & SSO Hand-off

### 4.1 Identity Validation (Registration)

- On **register**, the backend accepts `email`, `password`, `password_retype`, and optional `business_unit_id`. Password must meet **complexity** rules from policy (min length and, when enabled, at least one of upper/lower/number/symbol). It requires `password === password_retype` (400 if not) and extracts the email domain (e.g. `user@kpn-corp.com` → `kpn-corp.com`) to check against the **allowed_domains** table.
- If the domain is **not** in the whitelist, the API responds with **400** and message **"Email domain not authorized."** and does not create the user. If `business_unit_id` is provided, it must reference an active (non–soft-deleted) business unit. On **change-password** (and change-password-expired), the new password must not match the **current** or any of the **last N** hashes in **user_password_history** (N = password_history_count).
- The registration UI is supplied with active BUs via unauthenticated **`GET /api/auth/registration-options`** (returns `{ business_units }`). Only Admins can add/remove allowed domains (CRUD). **Domain lockout mitigation:** the API does not allow deleting the last allowed domain.

### 4.2 Access Control (Dashboard)

- The **application grid** returned to the user is filtered by:
  - `applications.target_bu_id IS NULL` (Global), **OR**
  - `applications.target_bu_id = current_user.business_unit_id`
- The backend endpoint **`GET /api/applications/for-me`** applies this filter using the authenticated user’s `business_unit_id` (loaded from the database). **`GET /api/auth/me`** returns the current user with `business_unit_id` and `business_unit_name`; the dashboard UI shows the BU in the header when set.

### 4.2a Password and Security Policy (Expiry, Complexity, History, Lockout)

- **Admin → Password policy (Security policy):** Admins set **password_expiry_days** (0 = disabled, 1–365), **min_password_length**, **complexity** toggles (upper/lower/number/symbol), **password_history_count**, **max_login_attempts**, **lockout_duration_mins**. Stored in **password_policy** table.
- **Login:** Before password check, if user exists and **locked_until** is set and **now() &lt; locked_until**, return **423** with `code: ACCOUNT_LOCKED` and optional `locked_until`; do not increment attempts. After validating email and password, the API checks whether **password_expiry_days** &gt; 0 and `password_changed_at + password_expiry_days` is in the past. If expired, login returns **403** with `code: PASSWORD_EXPIRED`; no token is issued. The frontend redirects to **/change-password-expired**. **Wrong password:** increment **failed_login_attempts**; if new value ≥ **max_login_attempts**, set **locked_until = now() + lockout_duration_mins**; return 401. **Success:** set **failed_login_attempts = 0**, **locked_until = null**.
- **Change password (expired):** **POST /api/auth/change-password-expired** (no auth) accepts email, current password, new password, confirm; validates complexity and history; updates **password_hash** and **password_changed_at**; returns token so the user can be signed in immediately.
- **Change password (authenticated):** **POST /api/auth/change-password** (with auth) validates new password against complexity and history; allows a logged-in user to change their own password. **PASSWORD_CHANGE** is written to **audit_logs**.
- **Admin unlock:** **POST /api/users/:id/unlock** (Admin only) sets **failed_login_attempts = 0** and **locked_until = null**; audit **UNLOCK**.

### 4.3 SSO Hand-off: Token in Header (Not URL)

To avoid token exposure in browser history and server logs, the Hub **must not** append the token to the redirect URL. Token delivery uses **header-based** auth.

**Token strategy: short-lived bearer (e.g. JWE)**

1. **Generation**  
   When the user clicks an app card, the Hub generates a short-lived token (e.g. JWE) containing `user_id` and timestamp (issued-at), signed/encrypted with a shared secret (or key pair) known to the Hub and the downstream app.

2. **Delivery (no URL)**  
   The Hub implements a **bridge page** (`GET /api/sso/bridge?ref=...`). The frontend redirects the user to this URL with a signed **ref** (one-time, short-lived). The bridge decodes the ref to obtain the token and target URL, then returns HTML that **auto-POSTs** to the target app’s landing URL with the token in the request **body** (form field **`token`**). Target apps must accept POST at their landing endpoint and read the token from the body to validate and create the user session. Set **`API_PUBLIC_URL`** in production to the public API base URL so the bridge link is correct.

3. **Validation (downstream app)**  
   The downstream app:
   - Reads the token from the **`Authorization`** header (not from query or body if possible, to avoid logging).
   - Decrypts/verifies the token and checks that the timestamp is **&lt; 60 seconds** old.
   - If valid, logs the user in (e.g. by `user_id` or mapped identity).

### 4.4 Caching (Redis)

- Redis (ApsaraDB) is used to store or look up short-lived SSO tokens to keep **redirect + auth latency under 200 ms** and to support revocation/expiry if needed.

---

## 5. Security & Risk Mitigation

A detailed **penetration test and security report** (findings fixed vs open) is maintained in **[Docs/PENTEST-REPORT.md](Docs/PENTEST-REPORT.md)**.

| Measure | Description |
|---------|-------------|
| **Token expiration** | SSO tokens expire within **60 seconds** to prevent replay attacks. |
| **Header-based auth** | Token is **never** passed in the URL; only in **Authorization: Bearer** (or equivalent) to avoid exposure in browser history and server logs. |
| **Admin operations** | All Admin CRUD operations (applications, allowed_domains, business_units, user BU) require a validated **Admin** role check in the JWT middleware. |
| **Domain lockout** | Safeguard so Super Admins are not locked out: e.g. do not allow deletion of an allowed domain if it would leave zero Admins able to log in, or prevent deleting the last allowed domain. |
| **Secrets / Encryption** | Sensitive environment variables (Database URLs, SSO Private Keys) are injected via **Alibaba Cloud KMS** during the CI/CD build phase; they are not committed to the repo. |
| **Validation** | Admin input (e.g. `target_url`, domain) is validated (URL format, length); delete actions use a **confirmation modal** to avoid accidental removal. |
| **Account lockout** | After X failed logins (configurable), account is locked for Y minutes; Admin can unlock; reduces brute-force risk. |
| **Password complexity and history** | Configurable min length and character types; last X passwords cannot be reused (stored in user_password_history). |

---

## 6. CI/CD Pipeline

| Stage | Trigger | Action |
|-------|---------|--------|
| **Build** | PR to `main` or `develop` | Build frontend and backend artifacts. |
| **Test** | Same as build | Run **unit tests** and **integration tests**. |
| **Deploy to Testing** | Merge to `develop` | **Automatic** deployment to the Alibaba Cloud Testing environment (e.g. ACK Staging). |
| **Deploy to Production** | Merge to `main` | **Manual approval** required; then deploy to the Alibaba Cloud Production environment (e.g. ACK Prod). |

Secrets for Testing and Production are supplied via KMS in the pipeline, not from repo or plain env files.

---

## 7. Logging & Audit Trail Specification

To support security, accountability, and the **&lt; 200 ms** and **Adoption Rate** success metrics, the system implements two logging layers plus SSO access logs.

### 7.1 System Application Logs (ELK / Alibaba Cloud SLS)

Standard application logs are captured for all environments (Dev, Testing, Prod) to monitor system health and latency.

| Aspect | Specification |
|--------|----------------|
| **Metadata** | Timestamp, Environment ID, Trace ID, Log Level (INFO, WARN, ERROR), Source Module. |
| **Performance tracking** | Every SSO hand-off event must log **Generation Time** to ensure the &lt; 200 ms target is met. |
| **Storage** | 30-day retention in **Alibaba Cloud Log Service (SLS)**. |

### 7.2 Administrative Audit Trail (Database-level)

Any **write** operation—Admin CRUD on applications, **allowed_domains**, **business_units**, user BU assignment, and **login**—is recorded in an immutable **`audit_logs`** table (see §3.5). The table is **append-only**: no user (including Admins) has DELETE (or UPDATE) permissions.

### 7.3 SSO Access Logs

To track the **Adoption Rate** success metric and security, every SSO attempt is recorded in **`sso_access_logs`** (see §3.6): **user_id**, **application_id**, **outcome** (success/failure), and timestamp. Optionally include **ip_address**.

---

## 8. Updated Environment Configuration (Logging)

Logging-specific keys are added to `.env` files so Dev logs do not clutter Production analytics.

| Environment | Config file | Logging keys |
|-------------|-------------|--------------|
| **Dev** | `.env.local` | `LOG_LEVEL=debug`, `STDOUT_ONLY=true` |
| **Testing** | `.env.testing` | `LOG_LEVEL=info`, `SLS_PROJECT=hub-test` |
| **Production** | `.env.production` | `LOG_LEVEL=warn`, `SLS_PROJECT=hub-prod`, `AUDIT_RETENTION=365_DAYS` |

---

## 9. Security Mitigation (Audit Focus)

| Measure | Description |
|---------|-------------|
| **Tamper-proofing** | Audit logs are **append-only**. No user, including Admins, has **Delete** permissions on the `audit_logs` table. |
| **Alerting** | Real-time alerts via **Alibaba Cloud SLS** for repeated failed login attempts or unauthorized attempts to access the Admin Console. |
| **Account lockout** | After X failed logins (configurable), account is locked for Y minutes or until Admin unlock; enforced in login flow. |
| **Password history** | Last X password hashes stored; change-password rejects reuse of recent passwords. |

---

## 10. Reference to PRD / Tech Spec

- **Product scope and user stories:** [Downstream Hub PRD](Docs/Downstream%20Hub%20PRD.docx)  
- **Original technical specification:** [Downstream Hub Tech Spec](Docs/Downstream%20Hub%20Tech%20Spec.docx)  
- **Project overview and quick start:** [README.md](README.md)
