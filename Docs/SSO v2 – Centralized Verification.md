# SSO v2 – Centralized Verification Model

> **For downstream app developers:** implement from [SSO-INTEGRATION-GUIDE.md](./SSO-INTEGRATION-GUIDE.md) (§4 is the developer contract for this model). This document explains the **strategy and UX goals** only.

## High-Level Strategy: Centralized Verification

The core of this "seamless" model is that the SSO Hub acts as the gatekeeper for identity verification. Once the Hub verifies a user via a Magic Link, all downstream applications trust that verification and perform **Silent Provisioning** or **Automatic Linking**.

---

## 1. The End-to-End Flow (First Login)

### Step 1: The Verification Trigger (Hub-Led)

Instead of the user hitting an error in the target app, the process begins at the source:

* **For New Users**:
  An admin invites the user via the Hub. The Hub sends the Magic Link email.

* **For Existing Local Users**:
  When the user first attempts to log in via SSO, the Hub detects they have not been "OIDC-verified" yet and triggers the Magic Link to their corporate email.

---

### Step 2: Out-of-Band Confirmation

* The user clicks the Magic Link in their inbox.
* The Hub marks the user's status as verified and associates their session with a confirmed email.

---

### Step 3: The OIDC Handshake

* The user is redirected to the target app with a signed ID Token.

**Security Requirement:**

* The token must contain:

  * `email_verified: true`
  * Permanent `sub` (UUID)

---

### Step 4: Silent Resolution (Target App Logic)

The target app receives the token and performs a "silent" check:

* **Scenario A: Email Match Found (Existing Account)**

  * Automatically update the local record with the `sub` from the token
  * Set `auth_source = 'sso'`
  * No further user action required

* **Scenario B: No Match Found (New Account)**

  * Perform **Silent JIT Provisioning**
  * Create a new local record using `sub` and email from the token

---

## 2. Technical Architecture & Roles

| Responsibility  | SSO Hub (Provider)                                    | Target App (Downstream)                     |
| --------------- | ----------------------------------------------------- | ------------------------------------------- |
| Identity Logic  | Generates UUID (`sub`) and manages Magic Link mailers | Validates JWT signatures via Hub JWKS       |
| Verification    | Triggers and validates Magic Link for first login     | Trusts the `email_verified` claim in token  |
| Account Linking | None                                                  | Automatically binds `sub` to existing email |
| Provisioning    | None                                                  | Performs Silent JIT for new users           |

---

## 3. Developer Contract: Updated Requirements

The rules below are **normative in [SSO-INTEGRATION-GUIDE.md §4](./SSO-INTEGRATION-GUIDE.md#4-sso-v2--centralized-verification-and-silent-account-linking)**. This section summarizes them for product readers.

### A. The "Silent Upsert" Policy

Developers must implement a non-blocking login flow:

1. **Check 1:** Does `sso_uuid` exist?
   → If yes, log in

2. **Check 2:** If no, does email exist?
   → If yes, auto-link the `sso_uuid` to that record and log in

3. **Check 3:** If neither exists
   → Auto-create (provision) the user with a default role

---

### B. Security Constraints

* **Strict Claim Check**
  Apps must reject any token where `email_verified` is not `true` for the first login attempt

* **Domain Restriction**
  Only perform auto-linking/provisioning for verified corporate domains (e.g., `@kpn-corp.com`)

* **Audit Logging**
  Every auto-link or JIT creation must be logged locally with:

  * `sub`
  * Timestamp

---

## 4. User Experience Benefits

1. **Reduced Friction**
   Users never see a "Link Your Account" or "Collision Error" screen in target apps

2. **No Manual Linking**
   Admins no longer need to manually bridge accounts via database or UI

3. **One-Time Setup**
   The Magic Link is a "one-and-done" process. After the first verified login, all future logins across apps are instantaneous

---

## Summary

This model provides a strong security perimeter by ensuring only verified inbox owners can access or claim accounts, while keeping the application-level experience completely invisible to the end user.

---

