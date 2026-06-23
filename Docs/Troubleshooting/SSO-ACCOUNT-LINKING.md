# SSO Account Linking Troubleshooting

## 1) Quick checks

- Confirm migration `008_sso_account_linking.sql` has run.
- Confirm user row has `oidc_sub`, `oidc_linked_at`, `oidc_linked_by_mode`.
- Confirm email service is configured when using verification-based linking.

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

## 3) Admin-initiated linking

Use **Admin → Users → Generate SSO link** to produce a one-time prelink URL for a specific user. The link is delivered manually (e.g. email or Slack). Once the user clicks it and completes the Hub flow, their account is linked. Review the full event history per user via `GET /api/users/:id/sso-events`.
