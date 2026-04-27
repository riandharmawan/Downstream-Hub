# Downstream Hub SSO Integration Guide (Strict OIDC Mode)

This guide is the current contract for downstream applications.

Legacy bridge POST (`/api/sso/bridge`) and HS256 shared-secret integration are no longer the target path in strict mode.

---

## 1) Required flow

Downstream Hub acts as OIDC provider:

1. User clicks app in Hub dashboard.
2. Hub starts authorization code flow with PKCE.
3. Your app receives `code` (and `state`) on registered redirect URI.
4. Your app calls Hub token endpoint to exchange `code` + `code_verifier`.
5. Your app validates returned `id_token` using Hub JWKS.
6. Your app creates local session and redirects user to app home.

---

## 2) OIDC endpoints

Use these endpoints from Hub:

- Discovery: `GET /api/sso/.well-known/openid-configuration`
- Authorization: `GET /api/sso/authorize`
- Token: `POST /api/sso/token`
- JWKS: `GET /api/sso/jwks`

Example (local):

- `http://localhost:4000/api/sso/.well-known/openid-configuration`

---

## 3) Required token validation

Validate `id_token` with JWKS and enforce:

- `alg` must match provider metadata (currently `RS256`)
- `iss` equals Hub issuer
- `aud` equals your app client id
- `exp` not expired
- `sub` present (primary identity key)

Recommended claim usage:

- Identity key: `sub`
- Attributes: `email`, `name`

---

## 4) App registration required in Hub

In Hub Admin -> Applications, each app must have:

- `sso_mode = oidc`
- `oauth_client_id` set
- `oidc_redirect_uris` set (exact allowed callback URLs)

If these are missing, Hub blocks launch in strict mode.

---

## 5) Code exchange contract

Token endpoint request:

`POST /api/sso/token` JSON body:

```json
{
  "grant_type": "authorization_code",
  "code": "<authorization-code>",
  "redirect_uri": "https://your-app/callback",
  "client_id": "your-client-id",
  "code_verifier": "<pkce-verifier>"
}
```

Token endpoint response:

```json
{
  "token_type": "Bearer",
  "expires_in": 60,
  "id_token": "<jwt>",
  "scope": "openid profile email"
}
```

---

## 6) Migration checklist for downstream apps

1. Add OIDC callback endpoint (`redirect_uri`) in your app.
2. Store and verify PKCE `code_verifier` per login attempt.
3. Exchange `code` at Hub token endpoint.
4. Validate `id_token` via Hub JWKS.
5. Use `sub` for user upsert/mapping.
6. Remove dependency on legacy `/auth/hub` bridge POST path.

---

## 7) Security requirements

- Use HTTPS in SIT/PROD for all redirect and token traffic.
- Do not log raw `code`, `id_token`, or secrets.
- Reject any token failing `iss`/`aud`/`exp` checks.
- Keep `state` and PKCE verifier bound to the same browser session.

---

## 8) Troubleshooting

- Error: `SSO OIDC-only enforcement is enabled... sso_mode=oidc`
  - Set app `sso_mode` to `oidc` and configure `oauth_client_id` + `oidc_redirect_uris`.

- `invalid_grant` on token exchange
  - Check `redirect_uri`, `client_id`, and `code_verifier` exactly match authorization request.

- Signature validation fails
  - Refresh JWKS and ensure you validate against current `kid`.

---

## 9) Quick runtime checks

```bash
curl -i http://localhost:4000/api/sso/jwks
curl -i http://localhost:4000/api/sso/.well-known/openid-configuration
```

If strict mode is active:

- `/api/sso/bridge` returns `410`
- OIDC discovery and JWKS endpoints return `200`
