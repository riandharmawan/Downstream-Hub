# Magic Link Capability Plan

## Objective

Define and track implementation status for magic-link driven identity verification across key authentication and account flows.

## Current Snapshot

- Baseline magic-link request + verify for sign-in is implemented.
- Registration activation flow is implemented (inactive until email verification).
- Per-application first-login challenge is implemented (email verification required on first app access).
- Password reset legitimacy verification is implemented as a two-step email proof flow (request -> verify link -> reset token).
- **Hub session revalidation** (Case 3): **implemented** — **Hub-wide** (one interval per user for the Hub), not per downstream application.
- **Additional high-risk events** (Case 5): **partially implemented** — V1 unusual login context (new IP pattern) with policy controls and login step-up challenge.

## Use Cases and Status

| # | Use Case | Business Goal | Current Status | Notes |
|---|---|---|---|---|
| 1 | Registration -> activation link | Verify ownership of email before account becomes active | Implemented | Registration creates inactive user and requires activation link before login |
| 2 | First login to specific application -> magic link | Verify person intent per downstream application | Implemented | First app open triggers verification email; app launch allowed after successful verification |
| 3 | Every X days -> Hub session revalidation | Periodic proof it is still the legitimate user accessing the Hub | Implemented | Hub-level only; enforced on **login and active sessions**; `0` days disables the feature |
| 4 | Forgot password -> magic link proof | Confirm reset requester controls inbox | Implemented | Two-step flow: request email -> verify link -> one-time reset token exchange |
| 5 | Additional high-risk events (`etc`) | Step-up verification for sensitive actions | Partially Implemented | V1 delivered for unusual login context (new IP). V2 (GeoIP/new device/impossible travel) remains backlog |

## Status Legend

- Not Started: not implemented in backend/frontend yet.
- Planned: design direction is defined but code path not complete.
- Partially Implemented: baseline flow exists; additional hardening/scope pending.
- Implemented: fully functional with policy, audit, and UX.

## Detailed Plan by Case

### 1) Registration Activation

Status: **Implemented**

Implementation:

- Create activation-token intent and storage strategy (reuse shared token table with `intent`, or dedicated table).
- On registration, create user in `pending_activation`.
- Send activation email link with short TTL and one-time token.
- Verify endpoint marks token used and flips account to `active` + `email_verified_at`.
- Block sign-in for non-activated users with clear UX message and resend path.

Exit criteria:

- New users cannot sign in before activation.
- Activation links are one-time and expire correctly.
- Generic request/verify messaging avoids account enumeration.

### 2) First Login per Application

Status: **Implemented**

Implementation:

- Persisted app-scoped verification state (`user_id`, `application_id`, `last_verified_at`).
- Added first-use challenge in SSO redirect flow:
  - if no verification exists for (`user_id`, `application_id`), send one-time verification email link
  - return challenge-required response instead of SSO bridge URL
- Added verification endpoints to validate and consume app verification link.
- On successful verification, mark app as verified for the user and allow next app launch.
- SSO access logs capture challenge-required, challenge-verified, and success outcomes.

Exit criteria:

- First login to each app requires successful magic-link verification. **(Done)**
- Repeat login behavior is policy-based (no repeated challenge unless required). **(Done for first-login policy)**

### 3) Hub Session Revalidation Every X Days

Status: **Implemented**

**Scope (authoritative product spec)**

- **Hub-level only**: one revalidation clock per **user** for access to **Downstream Hub** (dashboard, Hub APIs behind the normal session, etc.). This is **not** the same as Case 2 (per-application first open / SSO).
- **Admin configuration**: a single global interval **X** (days), editable in Admin under the existing password policy area, with UI label **Hub session revalidation** (do not append “(magic link)” to that label in the UI).
- **`X = 0`**: feature **disabled** — no periodic Hub revalidation regardless of how long ago the user last revalidated.
- **While inside the window** (example: `X = 7`, days 0–6 after last successful Hub revalidation): user reaches post-login Hub experience as today, with no extra email step.
- **On or after day X** (first Hub access that falls outside the window):

  1. User must not reach the Hub dashboard / post-login experience until revalidation completes.
  2. Hub sends an email with a one-time link (magic link).
  3. **Password flow alignment**: user proves password (or equivalent primary auth) as today; **full Hub session is not granted** until the email link step succeeds. After clicking the link, Hub treats the user as revalidated for another **X** days and then allows normal post-login navigation (e.g. redirect to dashboard).

**Enforcement surfaces**

- **Login**: after primary authentication succeeds, if revalidation is due, do not return a normal access token (or return a dedicated state) until the magic-link step completes; send the email.
- **Session**: if the user already holds a valid JWT (or equivalent) but revalidation becomes due while they use the Hub, **block** protected Hub routes (e.g. `/api/auth/me`, dashboard data) until they complete the same magic-link flow; do not allow a “stale” session to bypass the policy.

**Data model (implementation direction)**

- Store a **user-level** timestamp such as `last_hub_session_revalidated_at` (exact column name TBD in implementation).
- Store the global **X** in the existing single-row policy (e.g. extend `password_policy` with `hub_session_revalidation_days` or similar) so Admin continues to use `GET/PUT /api/settings/password-policy` with one new field.

**Exit criteria**

- With `X > 0`, revalidation is required again after **X** days on both new logins and ongoing sessions.
- With `X = 0`, no Hub periodic revalidation runs.
- Admin can change **X** without code deploy; copy in Admin clearly describes Hub-only behavior and the login + session rule.

### 4) Forgot Password Legitimacy Verification

Status: **Implemented**

Implementation:

- Forgot-password request returns a generic anti-enumeration response while issuing a one-time verification link for existing users.
- Verification endpoints validate and consume forgot-password verification tokens.
- Successful verification mints a short-lived reset token used by the reset-password form endpoint.
- Reset completion rotates credentials and keeps one-time-token guarantees (hashing, expiry, single use).

Exit criteria:

- Two-step model implemented, documented, and tested.
- Abuse protections remain (rate limit, generic responses, one-time token).

### 5) Additional High-Risk Events

Status: **Partially Implemented**

Implemented now (V1 scope):

- Unusual login context based on new IP pattern with monitor/enforce policy modes.
- Dedicated admin configuration section for login-risk controls.
- Login-time step-up verification (email one-time link) when policy requires challenge.

Candidate next triggers / V2 backlog:

- Email change
- Role/permission elevation
- Sensitive profile updates
- New device or unusual geo/IP login

Implementation direction:

- Continue expanding the common risk engine to include GeoIP/impossible-travel and new-device signals for this case.

## Suggested Delivery Phases

### Phase 1 (Complete)

- Registration activation (Case 1).
- Baseline Hub magic-link sign-in where applicable.
- Forgot-password baseline documented.

### Phase 2 (Complete)

- Per-application first-login challenge (Case 2) and persistence.

### Phase 3 (Complete)

- **Case 3: Hub session revalidation** (login + session), policy field, user-level timestamp, email link + verify flow, and Admin **Hub session revalidation** control.

### Phase 4 (In Progress)

- Expand Case 5 from V1 (new IP risk) to V2 (GeoIP/impossible travel/new device) and add more high-risk action triggers.

## Dependencies and Risks

- Case 3 requires schema updates for the user-level revalidation timestamp and policy column.
- Session enforcement must be consistent (JWT claims vs DB check, or middleware on Hub API) so users cannot bypass via old tokens.
- Needs clear UX for link expiry, resend cooldown, and delayed email scenarios.
- Security controls must stay consistent: token hashing, one-time use, strict TTL, audit logs, and generic responses where appropriate.

## Owner Checklist

- [x] Forgot-password uses two-step verification (request -> verify -> reset).
- [x] Hub revalidation is **global / Hub-level** (not per-application); Case 2 remains per-app.
- [x] First high-risk rollout includes unusual login context (new IP pattern).
- [ ] Approve phased implementation order.
