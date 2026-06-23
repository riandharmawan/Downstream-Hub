# Downstream Hub

A centralized **Single Source of Truth** console that gives employees secure, single sign-on (SSO) access to internal company tools—reducing tab fatigue, bookmark clutter, and repeated logins.

**Author:** Rian Dharmawan · **Date:** 24 Feb 2026

---

## Vision & Goal

Provide one secure entry point for all internal tools so that:

- Employees stop juggling multiple bookmarks and credentials.
- IT/Admins spend less time on manual onboarding and link distribution.
- Access is consistent, traceable, and aligned with security practices.

---

## Target Users

| Role | Use Case |
|------|----------|
| **Employees** | Discover and open internal apps from one place with SSO. |
| **System Administrators** | Manage the application catalog (add, update, remove apps) and keep the hub current. |

---

## Problem Statement

Employees today face:

- **Tab fatigue** from many open internal app tabs.
- **Inefficiency** from managing bookmarks and separate logins.
- **Productivity loss** and **security risk** from ad-hoc URL sharing and credential reuse.

Downstream Hub addresses this with a single portal and secure token hand-off to downstream apps.

---

## What’s In Scope

- **Identity:** Self-registration and login (company email). Registration is restricted to **allowed domains** (whitelist); invalid domain returns *"Email domain not authorized."* Registration includes **confirm password** and optional **Business Unit** selection; the first user becomes Admin.
- **Domain whitelist:** Admins manage a list of allowed email domains (e.g. `@kpn-corp.com`). Only users with an allowed domain can register.
- **Business units (BUs):** Admins manage BUs and assign users to a BU. Users can select a BU at registration; Admins can change a user’s BU in Admin → Users. Applications can be assigned to a specific BU or **"All BUs (Global)"**. The dashboard shows only apps for the user’s BU or Global, and the user’s BU is shown in the dashboard header.
- **Discovery:** Grid view of internal applications (icon, name, short description), **filtered by the user’s Business Unit or Global apps**.
- **Admin:** Full CRUD on applications (name, icon, description, link, **Target BU**), on **Allowed Domains**, and on **Business Units**; URL validation and delete confirmation. The Admin console uses **sub-menus** (sidebar): **Domains** (`/admin/domains`), **Business Units** (`/admin/business-units`), **Users** (`/admin/users`), **Applications** (`/admin/applications`). Admins can assign/update a user’s BU.
- **SSO hand-off:** Secure token generation; token is **not** passed in the URL. The bridge page POSTs the token to the target app (form body); target apps can read the token from the request body or support **Authorization** header. Target apps must accept and validate the token (e.g. 60s TTL).
- **Audit:** All Admin CRUD actions and SSO access (user, app, outcome) are logged. The audit table is append-only; SSO attempts are recorded in `sso_access_logs`.
- **Password expiry:** Admins set "Password expires after X days" in Admin → Password policy. Expired users must change password before signing in; logged-in users can change password from the Dashboard.
- **Security policy (configurable):** **Password complexity** (min length, uppercase/lowercase/number/symbol), **password history** (no reuse of last X passwords), **account lockout** (lock after X failed logins; unlock after configured duration or by Admin). Policy is set in Admin → Security policy; Admins can **Unlock** locked users in Admin → Users.
- **Seamless account linking (OIDC):** Users can connect/unlink SSO from **Change password** page (email verification required). Admins can generate one-time prelink URLs from Admin → Users and inspect full link event history per user.
- **Soft delete:** Core tables (users, applications, allowed_domains, business_units, sso_access_logs) use a `deleted_at` timestamp. Admin “Delete” soft-deletes rows; all API reads exclude soft-deleted data via a dedicated data access layer (see **technical-architecture.md** §3.7).


### Implementation Phases (Completed)

| Phase | Scope | Status |
|-------|--------|--------|
| **A** | Registration: BU dropdown, confirm password; public GET /api/auth/registration-options. | Done |
| **B** | Session and /me return business_unit; dashboard header shows BU. | Done |
| **C** | Admin polish: Applications section title/description; sidebar sub-routes. | Done |
| **D** | SSO and audit: Bridge page, token in body; audit and SSO access logs. | Done |
| **Password expiry** | Admin → Password policy (expire after N days); login blocks expired users; change-password-expired page; in-app Change password. | Done |
| **Security policy** | Complexity (min length, character types), password history (no reuse of last X), lockout (X failed attempts → lock; 30 min or Admin unlock); Admin Unlock in Users. | Done |
| **OIDC account linking** | Self-service connect/unlink, admin prelink/event history, auto-link email verification endpoints. | Done |

For step-by-step verification of all phases, see **[TESTING.md](TESTING.md)**. For a comprehensive test plan (unit, integration, E2E) aligned with the PRD, see **[Docs/TEST-PLAN.md](Docs/TEST-PLAN.md)**. For security and penetration test findings (fixed vs open), see **[Docs/PENTEST-REPORT.md](Docs/PENTEST-REPORT.md)**. For deployment to Alibaba Cloud (two servers: Frontend + Backend/DB), see **[Docs/DEPLOYMENT-ALICLOUD.md](Docs/DEPLOYMENT-ALICLOUD.md)**; for **Docker** on the same two servers, see **[Docs/DEPLOYMENT-ALICLOUD-DOCKER.md](Docs/DEPLOYMENT-ALICLOUD-DOCKER.md)**.

## What’s Out of Scope

- Third-party external API integrations (e.g. Slack, Jira).
- Detailed per-user usage analytics.
- User-specific pinning or customization of the grid.

---

## User Flow

1. **Identity validation** — User registers with email, password, confirm password, and optional Business Unit; system checks that the email domain is in the allowed whitelist.
2. **Login** — User signs in via Downstream Hub.
3. **Dashboard (filtered)** — User sees their **Business Unit** in the header (if set) and a grid of applications assigned to their BU or marked as **Global**.
4. **App selection** — User clicks an application card.
5. **Redirect & SSO** — Hub generates a short-lived token; user is sent to a bridge page that POSTs the token to the target app (token **not** in URL). The target app validates the token and authenticates the user automatically.

---

## User Stories (Summary)

| # | Area | User Story | Key Acceptance Criteria |
|---|------|------------|-------------------------|
| 1 | **Identity** | As a user, I want to register and log in so I can access my work tools securely. | Register with company email; system validates credentials and **allowed domain**; redirect to Grid View on success. |
| 2 | **Domain validation** | As an Admin, I want to manage a whitelist of domains so only authorized company emails can register. | Admin CRUD for Allowed Domains; system blocks registration for domains not on the list; error: *"Email domain not authorized."* |
| 3 | **Business units** | As an Admin, I want to manage Business Units and assign users/apps so access is scoped by department. | Admin CRUD for BUs; assign/update a user’s BU; assign apps to a BU or "All BUs (Global)". |
| 4 | **Discovery** | As a user, I want to see a grid of applications so I can find the tool I need. | Grid shows icon, name, short description **filtered by my BU or Global**; cards are clickable for redirect. |
| 5 | **Admin Console** | As an admin, I want to manage applications so users see relevant tools. | Fields for Name, Icon, Description, Link, **Target BU** (or Global); URL validation; confirmation modal before delete. |
| 6 | **SSO Hand-off** | As a user, I want to be automatically logged into target apps so I don’t re-enter credentials. | Secure token generated on click; token passed via **Authorization header** (not URL); target app validates 60s TTL. |

---

## Success Metrics

- **Adoption rate** — % of employees who use Downstream Hub as their primary tool-access portal.
- **Authentication latency** — Average time from click to authenticated redirect (target: **&lt; 200 ms**).
- **Admin efficiency** — Reduction in time IT/Admin spends on manual onboarding and link distribution.

---

## Tech Stack (High Level)

- **Frontend:** React.js SPA (Grid View + Admin Console).
- **Backend:** Node.js / Express.js REST API (auth, app metadata CRUD, token generation).
- **Database:** PostgreSQL (e.g. Alibaba Cloud RDS) for users and app metadata.
- **Caching:** Redis (e.g. ApsaraDB) for short-lived SSO tokens to meet latency targets.
- **Infrastructure:** Deployable to Alibaba Cloud (e.g. ACK) with separate Dev, Testing, and Production environments.

**Admin console structure:** The Admin page (`/admin`) uses a sidebar with four sub-menus. Visiting `/admin` redirects to `/admin/domains`. Each section is a separate sub-route so you can bookmark or share a direct link (e.g. `/admin/applications`).

For detailed architecture, data model, soft delete, SSO design, and CI/CD, see **[technical-architecture.md](./technical-architecture.md)**.

---

## Dependencies & Risks

| # | Item | Mitigation | PIC |
|---|------|------------|-----|
| 1 | **App token adoption** — Internal apps must accept the Hub’s token via **Authorization header** (not URL). | Coordinate with app owners; document token contract and 60s TTL validation. | Eng Lead |
| 2 | **Security** — Token must not appear in URL (browser history/logs). | Token delivered via header (e.g. bridge page with POST + Bearer header); short-lived expiry; secrets via KMS. | Sec Team |
| 3 | **Domain lockout** — Removing all allowed domains could lock out Admins. | Ensure Super Admins can always access whitelist; optional guard to prevent deleting the last domain. | Admin |

---

## Documentation

- **Product:** [Docs/Downstream Hub PRD.docx](Docs/Downstream%20Hub%20PRD.docx)
- **Technical:** [Docs/Downstream Hub Tech Spec.docx](Docs/Downstream%20Hub%20Tech%20Spec.docx)
- **Architecture:** [technical-architecture.md](technical-architecture.md)

---

## Quick Start (Development)

### With Docker (recommended — environment parity)

1. **Start Docker Desktop** (Windows/Mac) so Docker is running.
2. **Run the app** — use either:
   - **Double‑click** `start.bat` (Windows), or
   - **Terminal:**
     ```bash
     copy .env.example .env
     docker compose up --build
     ```
   The first run builds the images (a few minutes); later runs are quick.
3. Open **http://localhost:3000** (frontend) and **http://localhost:4000** (API). The app uses Dockerized PostgreSQL and Redis; no local install needed.
4. **First time:** Register a new account at http://localhost:3000/register. Enter email (domain must be in **Allowed Domains**), password, confirm password, and optionally choose a **Business Unit**. The **first user** is created as **Admin** (so you can open the Admin console, add allowed domains, Business Units, and applications). Later users are Employees. Your BU (if set) appears in the dashboard header after login.
5. To stop: press `Ctrl+C` in the terminal, or run `docker compose down`.

**After frontend or backend code changes:** Rebuild so the container serves the new code: run `docker compose up --build` (or double‑click `start.bat` again). In the browser, do a hard refresh (Ctrl+Shift+R or Cmd+Shift+R) so cached JavaScript is cleared.

**If you see "500 Internal Server Error" or "unable to get image" (API version v1.51)** — Your Docker client is using an API version newer than your Docker Desktop supports. Do this:

1. **Double‑click `fix-docker-api.bat`** (once). It sets `DOCKER_API_VERSION=1.43` for your user.
2. **Quit Docker Desktop** (right‑click the whale icon in the system tray → Quit).
3. **Start Docker Desktop** again and wait until it’s fully up.
4. **Double‑click `start.bat`** again.

Alternatively, update Docker Desktop to the latest version so it supports the newer API.

#### Connecting with pgAdmin (or another DB client)

Use the **same** values as in your `.env` (Docker Compose uses them when the Postgres container starts):

| Field    | Value from .env           | Example    |
|----------|----------------------------|------------|
| **Host** | `localhost` (or `127.0.0.1`) | localhost  |
| **Port** | `POSTGRES_PORT`            | 5432       |
| **User** | `POSTGRES_USER`            | hub        |
| **Password** | `POSTGRES_PASSWORD`     | (from .env)|
| **Database** | `POSTGRES_DB`          | downstream_hub |

**If you get "password authentication failed for user 'hub'":**

1. **Check your `.env`** — Open the project’s `.env` and confirm `POSTGRES_USER` and `POSTGRES_PASSWORD`. In pgAdmin, use **exactly** those values (no extra spaces; password is case-sensitive).
2. **Another Postgres is on 5432** — If you have **PostgreSQL installed on Windows** (e.g. from an installer), it may be using port 5432. Then pgAdmin connects to that one, not the Docker DB. Fix it by either:
   - **Option A:** In `.env`, set **`POSTGRES_PORT=5433`** (so Docker uses 5433). Restart the stack (`start.bat`), run `set-db-password.ps1`, then in pgAdmin use **Host:** `127.0.0.1`, **Port:** `5433` (and user/password from `.env`).  
   - **Option B:** Stop the local PostgreSQL Windows service (Services → stop "postgresql-x64-…") so only Docker is on 5432. Then pgAdmin with port 5432 will reach the Docker DB.
3. **Password was changed after first run** — Postgres sets the password only when the data directory is created. If you changed `.env` later, the running DB still has the **old** password. Either:
   - **Option A:** In pgAdmin, try the **previous** password you had in `.env` when you first ran `start.bat`, or  
   - **Option B:** Reset the database so it re-initializes with the **current** `.env` (this **deletes all DB and Redis data**):
     ```bash
     docker compose down -v
     docker compose up --build
     ```
     Or, to remove only the Postgres volume: run `docker compose down`, then `docker volume ls` to find the volume named like `*_postgres_data`, then `docker volume rm <that_name>`, then `docker compose up --build`.  
     After that, connect with pgAdmin using the **current** `POSTGRES_USER` and `POSTGRES_PASSWORD` from `.env`.

### Without Docker

1. Clone the repo and install dependencies (see `backend/` and `frontend/`).
2. Configure `.env` (copy from `.env.example`) with database, Redis, and auth/SSO settings.
3. Run PostgreSQL and Redis locally (or via Docker for DB only), then run database migrations and seed data when available.
4. Start backend: `cd backend && npm run dev`; start frontend: `cd frontend && npm run dev`.

For environment parity and deployment to Testing/Production, refer to **technical-architecture.md**. In production, set **`API_PUBLIC_URL`** to the public URL of your API (e.g. `https://api.yourcompany.com`) so the SSO bridge redirect works correctly.
