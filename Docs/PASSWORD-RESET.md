# Password reset (forgot password)

Downstream Hub supports self-service password reset via email (or console logging in dev when SMTP is not configured).

## Flow

1. User submits email on **Forgot password** (`/forgot-password`).
2. API `POST /api/auth/forgot-password` always responds with the same generic message (no account enumeration).
3. If the user exists, a one-time token is stored (SHA-256 hash only) and a link is emailed: `{PUBLIC_APP_URL}/reset-password?token=...`
4. User sets a new password on **Reset password** (`/reset-password`). The API does **not** return a session JWT; user must sign in again.
5. Successful reset bumps `token_version` so existing JWTs are invalidated.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PUBLIC_APP_URL` | Base URL of the Hub frontend for reset links (e.g. `https://hub.example.com` or `http://localhost:3000`). |
| `PASSWORD_RESET_TTL_MINUTES` | Token lifetime (default 30, max 120). |
| `RATE_LIMIT_FORGOT_PASSWORD_MAX` | Max requests per window per IP+email (default 5). |
| `RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS` | Window in ms (default 900000 = 15 min). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP for sending mail. |
| `SMTP_SECURE` | `true` for port 465; often `false` for 587 STARTTLS. |
| `MAIL_FROM` | From address (defaults to `SMTP_USER`). |

If SMTP is not configured, the API logs the reset URL to the server console (development use).

## Operations

- Run migrations after deploy so `006_password_reset.sql` applies (`users.token_version`, `password_reset_tokens`).
- Configure `PUBLIC_APP_URL` to the URL users actually open in the browser.
- For production, configure SPF/DKIM/DMARC for your sending domain (outside this repo).

## API

- `POST /api/auth/forgot-password` — body `{ "email": "..." }`
- `POST /api/auth/reset-password` — body `{ "token": "...", "new_password": "...", "new_password_retype": "..." }`
- `GET /api/auth/reset-token-info?token=...` — returns `{ "valid": true|false }` for the UI (no PII).

## JWT `tv` claim

Access tokens include `tv` (token version). After any password change or reset, `token_version` increments and old tokens return 401 with `code: TOKEN_STALE`.
