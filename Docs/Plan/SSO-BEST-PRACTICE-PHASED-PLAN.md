# SSO Security Hardening — Phased Plan (Reference Only)

**Status:** Planning document — no implementation commitment.  
**Last updated:** April 2026  
**Context:** Aligns Downstream Hub’s federation story with common industry practice (OIDC-style trust, asymmetric verification, and safer browser sessions), **without** requiring everything at once.

---

## 1. Purpose

This document records a **possible** roadmap if the product team decides to invest in SSO-related security improvements. It is **not** a mandate to change the codebase immediately.

**Goals of the roadmap (if adopted):**

1. **Phase 1 — Federation token hardening:** Move from shared-secret HS256 toward **asymmetric signing** (e.g. RS256/ES256) and **JWKS**, with standard claims (`iss`, `aud`, `sub`, etc.), while optionally keeping the current **bridge POST** delivery model for backward compatibility during migration.
2. **Phase 2 — OAuth 2.1 / OIDC for downstream apps:** Offer **authorization code + PKCE** so browser-based launches follow a standard OAuth/OIDC pattern instead of only a form POST of a JWT.
3. **Phase 3 — Hub SPA session storage:** Reduce XSS impact by moving the Hub portal’s API credentials from **`localStorage` + Bearer** toward **HttpOnly cookies** (with an explicit **CSRF** or **BFF** strategy).
4. **Phase 4 — Step-up MFA policy:** Add OTP/MFA enforcement with both **periodic re-verification (every N days)** and **risk-based triggers** (new device/location, suspicious behavior).

---

## 2. Current Baseline (As-Built)

| Area | Current behavior |
|------|------------------|
| Handoff to downstream apps | Short-lived JWT signed with **HS256** and `SSO_TOKEN_SECRET`; payload includes `user_id`, `email`, `iat`, `exp` (`Backend/src/routes/sso.js`). |
| Delivery | Authenticated user gets `bridgeUrl`; **bridge** decodes signed `ref` and returns HTML that **auto-POSTs** to the target app with body field `token`. |
| Hub API session | JWT issued with `jsonwebtoken` (HS256) for Hub login; SPA stores token in **`localStorage`** and sends `Authorization: Bearer` (`Backend/src/lib/authToken.js`, `Frontend/src/context/AuthContext.jsx`). |
| Applications catalog | `applications` table has `target_url`, etc.; no OAuth **`client_id`** / redirect allowlist in the initial schema—would be added if OIDC is implemented. |

Documentation for integrators: `Docs/SSO-INTEGRATION-GUIDE.md`, `Docs/.md doc/SSO-TARGET-APP-INTEGRATION.md`.

---

## 3. Target End State (High Level)

| Area | Direction (if phases are executed) |
|------|-------------------------------------|
| Handoff JWT | **RS256** (or ES256) with **`kid`**; public keys at **JWKS** URL; claims include **`iss`**, **`aud`**, **`sub`** (Hub user UUID), **`email`**, optional **`name`**. |
| Verification downstream | Relying parties fetch **JWKS** and verify signature + `iss` / `aud` / `exp` (no shared symmetric secret per app for signing—operational win at scale). |
| Browser integration | Prefer **authorization code + PKCE** (Phase 2) for new apps; deprecate form-POST-only after migration window. |
| Hub SPA | Session via **HttpOnly, Secure, SameSite** cookies + **CSRF** handling or **BFF** pattern (Phase 3). |
| MFA assurance | Step-up MFA challenge required when N-day interval expires or risk score passes threshold (Phase 4). |

---

## 4. Phase 1 — Federation Token Hardening (Keep Bridge POST Optional)

**Objective:** Improve cryptographic and claim-level hygiene **without** forcing every downstream app to switch integration protocol on day one.

**Work items (conceptual):**

1. **Key material:** Generate an RSA or EC key pair used only for Hub-as-IdP signing; protect the private key (env / secret manager). Expose **JWKS** at a stable URL (e.g. under `.well-known` or `/api/sso/jwks`).
2. **JWT claims:** Emit `sub` = Hub user UUID (align with OIDC subject); set `iss` to a configured issuer URL; set `aud` per registered application; include `email` and `name` where available; retain short `exp` TTL.
3. **Per-application audience:** Extend data model (e.g. `applications`) with a stable **`oauth_client_id`** or document use of `applications.id` as `aud` — pick one convention.
4. **Bridge `ref` token:** Clearly separate the inner **handoff token** from the outer **ref** signing strategy so ref tokens cannot be mistaken for app-facing ID tokens (algorithm / `typ` / audience).
5. **Migration:** Optional dual support: RS256 primary + HS256 deprecated behind env flag for a defined period; update `Docs/SSO-INTEGRATION-GUIDE.md` and target-app guides.
6. **Operations:** Document **key rotation** (`kid`, multiple JWKs in JWKS).

**Acceptance (if implemented):** Downstream app can verify handoff JWT using **JWKS only**; claims pass `iss`/`aud`/`sub` checks.

---

## 5. Phase 2 — OAuth 2.1 / OIDC for Downstream Apps

**Objective:** Standard browser flow: **authorization code + PKCE** instead of relying solely on POST-body JWT delivery.

**Work items (conceptual):**

1. **Client registration:** Per application: `client_id`, **allowlisted `redirect_uri`s**, PKCE required (S256).
2. **Endpoints:** Authorization (`GET /authorize`), token (`POST /token`), **OpenID Provider Metadata** (`/.well-known/openid-configuration`), **JWKS** URI (may reuse Phase 1 JWKS).
3. **Hub UI:** Launch downstream app by navigating to `/authorize` with PKCE parameters (or server-side redirect) instead of only `bridgeUrl` + form POST — exact UX to be designed to preserve “click app card → land in app logged in.”
4. **Tokens:** ID token JWT with same identity claims as Phase 1; optional access tokens if Hub later exposes APIs to downstream apps.
5. **Migration:** Feature flag or per-app mode: “legacy bridge POST” vs “OIDC” until all partners migrate.

**Acceptance (if implemented):** A test client completes code flow, exchanges code at token endpoint, validates ID token against JWKS and `nonce`/`aud` as applicable.

---

## 6. Phase 3 — Hub SPA: HttpOnly Session Cookies

**Objective:** Avoid storing long-lived Hub session tokens in **`localStorage`** (XSS risk).

**Work items (conceptual):**

1. **Backend:** After login/register, set **HttpOnly + Secure + SameSite** session cookie (opaque session id or signed cookie; preserve existing **token_version** / `tv` invalidation semantics where applicable).
2. **`authMiddleware`:** Support cookie-based session; optional transitional support for Bearer header.
3. **CSRF:** For cookie-authenticated mutating requests from SPA — double-submit token, SameSite strategy, or **Backend-for-Frontend** proxy — must be chosen explicitly.
4. **Frontend:** `credentials: 'include'` on API calls; remove reliance on `localStorage` for Hub JWT.
5. **CORS:** `Access-Control-Allow-Credentials: true` with explicit **Origin** (not `*`).
6. **Deployment:** Validate cookie behavior for **same-site** vs **cross-origin** Hub vs API URLs in staging/production.

**Acceptance (if implemented):** Functional login and API access work without readable token in `localStorage`; CSRF test cases pass.

---

## 7. Phase 4 — Step-up MFA (Every N Days + Risk-Based)

**Objective:** Add stronger login assurance without prompting MFA on every login.

**Work items (conceptual):**

1. **Policy model:** Add configurable `mfa_reverify_days` (N days), `risk_score_threshold`, and feature flags for progressive rollout.
2. **Challenge decision logic:** After primary password check, require MFA when either:
   - `last_mfa_verified_at` is older than N days, or
   - runtime risk score meets/exceeds threshold.
3. **Risk signals (v1):** New device fingerprint, new geo/IP profile, impossible travel, failed-login burst, and optional unusual login hour.
4. **Challenge channel:** Support OTP method (recommend TOTP first, then optional email/SMS fallback). Store only hashed OTP artifacts and enforce short TTL + retry limits.
5. **Remembered device:** Maintain trusted-device records with expiry aligned to N-day policy.
6. **Auditability:** Log outcomes as `MFA_REQUIRED_PERIODIC`, `MFA_REQUIRED_RISK`, `MFA_SUCCESS`, and `MFA_FAIL`.

**Acceptance (if implemented):** User is challenged when either periodic window expires or risk threshold is hit; successful challenge updates `last_mfa_verified_at`.

---

## 8. Testing Matrix (When Work Proceeds)

| Phase | Suggested checks |
|-------|------------------|
| 1 | Unit tests for claim set; integration: verify ID token with JWKS; regression: bridge still delivers `token` field. |
| 2 | Invalid redirect URI rejected; PKCE failure; authorization code reuse fails. |
| 3 | E2E with cookie only; CSRF negative tests. |
| 4 | MFA required when `last_mfa_verified_at` exceeds N days; MFA required for high-risk logins; OTP retry/expiry limits enforced. |

---

## 9. Explicitly Out of Scope (Unless Requested Later)

- Global **logout** across all downstream apps (back-channel logout / OIDC session management).
- Redis-backed authorization codes (optional performance/revocation improvement — mentioned in broader architecture docs).

---

## 10. Decision Record

**This file does not authorize engineering work.** Before implementation:

- Confirm product priority vs other roadmap items.
- Confirm partner migration tolerance (Phase 1 dual-mode vs hard cutover).
- Confirm production URL layout for Phase 3 cookies (same site vs BFF).
- Confirm OTP channel priority (TOTP only vs email/SMS fallback) and rollout scope (all users vs selected roles).

---

## 11. Related Documents

- `Docs/SSO-INTEGRATION-GUIDE.md`
- `Docs/.md doc/SSO-TARGET-APP-INTEGRATION.md`
- `technical-architecture.md` (SSO bridge and Redis notes)
