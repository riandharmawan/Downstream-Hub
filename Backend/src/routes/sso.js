/**
 * SSO: generate short-lived token; deliver via bridge page (POST body), not in URL.
 * Uses applicationsDb (excludes soft-deleted) and ssoAccessLogsDb.
 */
const crypto = require('crypto');
const express = require('express');
const { pool } = require('../db/pool');
const applicationsDb = require('../db/applicationsDb');
const ssoAccessLogsDb = require('../db/ssoAccessLogsDb');
const oidcDb = require('../db/oidcDb');
const usersDb = require('../db/usersDb');
const ssoLinkService = require('../services/ssoLinkService');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { getClientIp } = require('../middleware/audit');
const mailer = require('../lib/mailer');
const { SignJWT, jwtVerify } = require('jose');
const { loadKeys, hashSha256 } = require('../lib/ssoKeyStore');
const router = express.Router();
const SSO_EXPIRY_SECONDS = parseInt(process.env.SSO_TOKEN_EXPIRY_SECONDS || '60', 10);
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const OIDC_CODE_TTL_SECONDS = parseInt(process.env.OIDC_CODE_TTL_SECONDS || '120', 10);
const ENFORCE_OIDC_ONLY = process.env.SSO_ENFORCE_OIDC_ONLY === '1';
/** Dev/staging only: force id_token email_verified true without DB flag. */
const OIDC_EMAIL_VERIFIED_TRUST_ALL = process.env.OIDC_EMAIL_VERIFIED_TRUST_ALL === '1';

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function effectiveEmailVerified(userRow) {
  if (OIDC_EMAIL_VERIFIED_TRUST_ALL) return true;
  return !!userRow?.hub_oidc_email_verified_at;
}

async function signSsoToken(payload, audience) {
  const keyStore = await loadKeys();
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: payload.user_id,
    user_id: payload.user_id, // kept for backward compatibility
    email: payload.email,
    name: payload.name || payload.email,
    email_verified: payload.email_verified === true,
    iss: keyStore.issuer,
    aud: audience,
    iat: now,
  };

  if (keyStore.alg === 'HS256') {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', kid: keyStore.kid, typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + SSO_EXPIRY_SECONDS)
      .sign(keyStore.hsSecret);
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: keyStore.alg, kid: keyStore.kid, typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(keyStore.issuer)
    .setAudience(audience)
    .setExpirationTime(now + SSO_EXPIRY_SECONDS)
    .sign(keyStore.privateKey);
}

async function signBridgeRef(refPayload) {
  const keyStore = await loadKeys();
  const now = Math.floor(Date.now() / 1000);
  if (keyStore.alg === 'HS256') {
    return new SignJWT(refPayload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: keyStore.kid })
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(keyStore.hsSecret);
  }
  return new SignJWT(refPayload)
    .setProtectedHeader({ alg: keyStore.alg, typ: 'hub-bridge-ref', kid: keyStore.kid })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(keyStore.privateKey);
}

async function verifyBridgeRef(ref) {
  const keyStore = await loadKeys();
  if (keyStore.alg === 'HS256') {
    const { payload } = await jwtVerify(ref, keyStore.hsSecret);
    return payload;
  }
  const { payload } = await jwtVerify(ref, keyStore.publicKey);
  return payload;
}

function parseRedirectUriList(app) {
  if (!Array.isArray(app.oidc_redirect_uris)) return [];
  return app.oidc_redirect_uris.map((x) => String(x || '').trim()).filter(Boolean);
}

function buildSsoLoginRedirectUrl(req, clientId) {
  const loginUrl = new URL(`${PUBLIC_APP_URL}/login`);
  loginUrl.searchParams.set('returnTo', req.originalUrl);
  if (clientId) loginUrl.searchParams.set('client_id', clientId);
  return loginUrl.toString();
}

/**
 * GET /api/sso/redirect?applicationId=uuid
 * Returns { bridgeUrl } — frontend redirects user to bridgeUrl. Token is NOT in the URL;
 * the bridge page POSTs the token to the target app (body or header per target contract).
 */
router.get('/redirect', authMiddleware, async (req, res) => {
  try {
    const applicationId = req.query.applicationId;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId required' });
    }
    const app = await applicationsDb.getById(pool, applicationId);
    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (app.sso_mode === 'none') {
      await ssoAccessLogsDb.insert(pool, {
        user_id: req.user.id,
        application_id: app.id,
        outcome: 'success',
        ip_address: getClientIp(req),
      });
      return res.json({ bridgeUrl: app.target_url, mode: 'none' });
    }

    if (app.sso_mode !== 'oidc') {
      return res.status(400).json({
        error: 'Application SSO mode is not configured. Set sso_mode to "oidc" or "none" in Admin.',
      });
    }

    const ssoUser = await usersDb.getForSsoToken(pool, req.user.id);
    if (!effectiveEmailVerified(ssoUser)) {
      const user = await usersDb.getById(pool, req.user.id);
      if (user) {
        const created = await ssoLinkService.createEmailVerification(pool, {
          actorId: req.user.id,
          user,
          subject: ssoLinkService.buildSyntheticSubjectForUser(user),
          mode: 'hub_oidc_email_verify',
        });
        if (created.ok) {
          const verifyUrl = `${PUBLIC_APP_URL}/login?sso_verify=${encodeURIComponent(created.tokenRaw)}`;
          try {
            await mailer.sendSsoLinkVerificationEmail({ to: user.email, verifyUrl });
          } catch (mailErr) {
            console.error('Hub OIDC email verification email error:', mailErr.message);
          }
        }
      }
      await ssoAccessLogsDb.insert(pool, {
        user_id: req.user.id,
        application_id: app.id,
        outcome: 'email_verification_required',
        ip_address: getClientIp(req),
      });
      return res.status(403).json({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        error:
          'Email verification is required for SSO. Check your inbox for a verification link, then open this app again.',
      });
    }

    const audience = app.oauth_client_id || app.id;
    const redirectUris = parseRedirectUriList(app);
    const redirectUri = redirectUris[0];
    if (!redirectUri) {
      return res.status(400).json({ error: 'Application is in OIDC mode but has no redirect URI configured' });
    }
    const codeVerifier = toBase64Url(crypto.randomBytes(48));
    const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = toBase64Url(crypto.randomBytes(16));
    const nonce = toBase64Url(crypto.randomBytes(12));
    const refPayload = {
      user_id: req.user.id,
      client_id: audience,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      code_verifier: codeVerifier,
    };
    const ref = await signBridgeRef(refPayload);
    const bridgeUrl = `${API_PUBLIC_URL}/api/sso/authorize?ref=${encodeURIComponent(ref)}&cv=${encodeURIComponent(codeVerifier)}`;

    await ssoAccessLogsDb.insert(pool, {
      user_id: req.user.id,
      application_id: app.id,
      outcome: 'success',
      ip_address: getClientIp(req),
    });

    res.json({ bridgeUrl, mode: 'oidc' });
  } catch (err) {
    console.error('SSO redirect error:', err);
    res.status(500).json({ error: 'Failed to generate redirect' });
  }
});

/**
 * GET /api/sso/bridge?ref=...
 * No auth — user arrives here from redirect. Verifies ref (signed JWT), then returns
 * HTML that auto-POSTs to the target app with the token in the request body (field "token").
 * Target apps must accept POST and read the token from body (or implement same contract).
 */
router.get('/bridge', async (req, res) => {
  if (ENFORCE_OIDC_ONLY) {
    return res.status(410).send('Bridge mode is disabled by SSO OIDC-only enforcement.');
  }
  try {
    const ref = req.query.ref;
    if (!ref) {
      res.status(400).send('Missing ref');
      return;
    }
    const payload = await verifyBridgeRef(ref);
    const { token, targetUrl } = payload;
    if (!token || !targetUrl) {
      res.status(400).send('Invalid ref');
      return;
    }
    const action = String(targetUrl).replace(/"/g, '&quot;');
    const tokenEscaped = String(token).replace(/"/g, '&quot;');
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting...</title></head>
<body>
<p>Redirecting to application...</p>
<form id="f" method="post" action="${action}">
  <input type="hidden" name="token" value="${tokenEscaped}" />
</form>
<script>document.getElementById('f').submit();</script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('SSO bridge error:', err);
    res.status(400).send('Invalid or expired link. Please try again from the hub.');
  }
});

router.get('/jwks', async (_req, res) => {
  const keyStore = await loadKeys();
  res.json(keyStore.jwks);
});

router.get('/.well-known/openid-configuration', async (_req, res) => {
  const keyStore = await loadKeys();
  res.json({
    issuer: keyStore.issuer,
    authorization_endpoint: `${API_PUBLIC_URL}/api/sso/authorize`,
    token_endpoint: `${API_PUBLIC_URL}/api/sso/token`,
    jwks_uri: `${API_PUBLIC_URL}/api/sso/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [keyStore.alg],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['none'],
  });
});

/**
 * GET /api/sso/login-context?client_id=...
 * Public display context for app-initiated SSO login (name/icon only).
 */
router.get('/login-context', async (req, res) => {
  try {
    const clientId = String(req.query.client_id || '').trim();
    if (!clientId) return res.status(400).json({ error: 'client_id required' });
    const app = await applicationsDb.getByOAuthClientId(pool, clientId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    return res.json({
      client_id: app.oauth_client_id,
      app_name: app.name,
      icon_url: app.icon_url || '',
    });
  } catch (err) {
    console.error('SSO login-context error:', err);
    return res.status(500).json({ error: 'Failed to load login context' });
  }
});

router.get('/authorize', optionalAuth, async (req, res) => {
  try {
    const fromRef = req.query.ref ? await verifyBridgeRef(String(req.query.ref)) : {};
    let actingUser = req.user;
    if (!actingUser && fromRef.user_id) {
      const u = await usersDb.getById(pool, String(fromRef.user_id));
      if (u) actingUser = { id: u.id, email: u.email, role: u.role };
    }
    const clientId = String(req.query.client_id || fromRef.client_id || '').trim();
    if (!actingUser) {
      return res.redirect(302, buildSsoLoginRedirectUrl(req, clientId));
    }
    const redirectUri = String(req.query.redirect_uri || fromRef.redirect_uri || '').trim();
    const responseType = String(req.query.response_type || fromRef.response_type || 'code');
    const codeChallenge = String(req.query.code_challenge || fromRef.code_challenge || '').trim();
    const codeChallengeMethod = String(req.query.code_challenge_method || fromRef.code_challenge_method || 'S256').trim();
    const scope = String(req.query.scope || fromRef.scope || 'openid profile email');
    const state = String(req.query.state || fromRef.state || '');
    const nonce = String(req.query.nonce || fromRef.nonce || '');

    if (responseType !== 'code') return res.status(400).send('Only response_type=code is supported');
    if (!clientId || !redirectUri || !codeChallenge) return res.status(400).send('Missing required OIDC parameters');
    if (codeChallengeMethod !== 'S256') return res.status(400).send('Only code_challenge_method=S256 is supported');

    const { rows } = await pool.query(
      'SELECT id, oauth_client_id, oidc_redirect_uris, sso_mode FROM applications WHERE oauth_client_id = $1 AND deleted_at IS NULL',
      [clientId]
    );
    const app = rows[0];
    if (!app || app.sso_mode !== 'oidc') return res.status(400).send('Unknown OIDC client');
    const allowedUris = Array.isArray(app.oidc_redirect_uris) ? app.oidc_redirect_uris : [];
    if (!allowedUris.includes(redirectUri)) return res.status(400).send('redirect_uri is not allowed');

    const code = toBase64Url(crypto.randomBytes(32));
    const expiresAt = new Date(Date.now() + OIDC_CODE_TTL_SECONDS * 1000);
    await oidcDb.insertAuthCode(pool, {
      rawCode: code,
      userId: actingUser.id,
      applicationId: app.id,
      clientId,
      redirectUri,
      scope,
      nonce,
      codeChallenge,
      codeChallengeMethod,
      expiresAt,
    });

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    if (fromRef.code_verifier) {
      // Transitional helper for dashboard-initiated flow so target apps can exchange code.
      url.searchParams.set('code_verifier', String(fromRef.code_verifier));
    }

    res.redirect(url.toString());
  } catch (err) {
    console.error('OIDC authorize error:', err);
    res.status(500).send('Authorization failed');
  }
});

router.post('/token', express.json(), async (req, res) => {
  try {
    const grantType = String(req.body?.grant_type || '');
    const code = String(req.body?.code || '');
    const redirectUri = String(req.body?.redirect_uri || '');
    const clientId = String(req.body?.client_id || '');
    const codeVerifier = String(req.body?.code_verifier || '');
    if (grantType !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
    if (!code || !redirectUri || !clientId || !codeVerifier) return res.status(400).json({ error: 'invalid_request' });

    const record = await oidcDb.consumeAuthCode(pool, code);
    if (!record) return res.status(400).json({ error: 'invalid_grant' });
    if (record.client_id !== clientId || record.redirect_uri !== redirectUri) return res.status(400).json({ error: 'invalid_grant' });

    const expectedChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    if (record.code_challenge_method !== 'S256' || expectedChallenge !== record.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }

    const user = await usersDb.getForSsoToken(pool, record.user_id);
    if (!user) return res.status(400).json({ error: 'invalid_grant' });

    const idToken = await signSsoToken(
      {
        user_id: user.id,
        email: user.email,
        name: user.name || user.email,
        email_verified: effectiveEmailVerified(user),
      },
      clientId
    );
    return res.json({
      token_type: 'Bearer',
      expires_in: SSO_EXPIRY_SECONDS,
      id_token: idToken,
      scope: record.scope,
    });
  } catch (err) {
    console.error('OIDC token error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
