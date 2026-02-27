/**
 * SSO: generate short-lived token; deliver via bridge page (POST body), not in URL.
 * Uses applicationsDb (excludes soft-deleted) and ssoAccessLogsDb.
 */
const express = require('express');
const { pool } = require('../db/pool');
const applicationsDb = require('../db/applicationsDb');
const ssoAccessLogsDb = require('../db/ssoAccessLogsDb');
const { authMiddleware } = require('../middleware/auth');
const { getClientIp } = require('../middleware/audit');
const { SignJWT, jwtVerify } = require('jose');

const router = express.Router();
const SSO_SECRET = process.env.SSO_TOKEN_SECRET || 'dev-sso-secret';
const SSO_EXPIRY_SECONDS = parseInt(process.env.SSO_TOKEN_EXPIRY_SECONDS || '60', 10);
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'http://localhost:4000';

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
    const baseUrl = app.target_url.replace(/\/$/, '');
    const targetPath = baseUrl.includes('/auth/') ? '' : '/auth/hub';
    const targetUrl = targetPath ? `${baseUrl}${targetPath}` : baseUrl;

    const payload = {
      user_id: req.user.id,
      email: req.user.email,
      iat: Math.floor(Date.now() / 1000),
    };
    const secret = new TextEncoder().encode(SSO_SECRET);
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(payload.iat)
      .setExpirationTime(payload.iat + SSO_EXPIRY_SECONDS)
      .sign(secret);

    const refPayload = { token, targetUrl, applicationId: app.id };
    const ref = await new SignJWT(refPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1m')
      .sign(secret);

    const bridgeUrl = `${API_PUBLIC_URL}/api/sso/bridge?ref=${encodeURIComponent(ref)}`;

    await ssoAccessLogsDb.insert(pool, {
      user_id: req.user.id,
      application_id: app.id,
      outcome: 'success',
      ip_address: getClientIp(req),
    });

    res.json({ bridgeUrl });
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
  try {
    const ref = req.query.ref;
    if (!ref) {
      res.status(400).send('Missing ref');
      return;
    }
    const secret = new TextEncoder().encode(SSO_SECRET);
    const { payload } = await jwtVerify(ref, secret);
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

module.exports = router;
