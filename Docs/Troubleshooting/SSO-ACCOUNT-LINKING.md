# SSO Account Linking Troubleshooting

## 1) Quick checks

- Confirm migrations through **`010_user_application_oidc_verified.sql`** (or later) have run (`sso_link_email_verifications.application_id`, table `user_application_oidc_email_verified`).
- Confirm user row has `oidc_sub`, `oidc_linked_at`, `oidc_linked_by_mode`.
- Confirm email service is configured when using verification-based linking.

### Per-app verification (strict)

- **`email_verified` on `id_token` is per registered Hub application.** Verifying via magic link for Application A does **not** set `email_verified: true` for Application B’s client id until the user completes a **separate** flow for B (Dashboard “Send verification email”, admin prelink with that `application_id`, or auto-link including `application_id`).
- Magic links should land on the **Dashboard** query shape: `/?application_id=<uuid>&sso_verify=<token>`. **`GET /api/users/sso/verify`** must receive the **same** `application_id` query param when the verification row stores one (prevents cross-app token replay).
- **Auto-link** requires `application_id` in `POST /api/auth/oidc/auto-link/start`.
- If **`OIDC_EMAIL_VERIFIED_TRUST_ALL=1`** is off and users were never backfilled, expect **`email_verified: false`** until each OIDC app has a consumed verification for that user.

## 2) Common issues

### `link_token_expired`

- Cause: verification token already used or expired.
- Action: trigger `POST /api/users/me/sso-connect/start` or admin prelink again.

### `oidc_sub_already_linked`

- Cause: subject already mapped to a different active user.
- Action:
  1. Review user history at `GET /api/users/:id/sso-events`.
  2. Validate target identity ownership.
  3. Admin can unlink wrong mapping via `POST /api/users/:id/sso-unlink`.

### Verification email not delivered

- Cause: SMTP not configured or delivery failure.
- Action:
  1. Check backend logs for mailer errors.
  2. In non-SMTP environments, verification URL is printed to backend logs.

## 3) Bulk operations

- Dry-run first via `POST /api/users/sso-link/bulk/dry-run`.
- Execute via `POST /api/users/sso-link/bulk/jobs`.
- Inspect results:
  - `GET /api/users/sso-link/bulk/jobs/:jobId`
  - `GET /api/users/sso-link/bulk/jobs/:jobId/items`
  - `GET /api/users/sso-link/bulk/jobs/:jobId/export.csv`
