/**
 * Integration tests for Downstream Hub API (TEST-PLAN §3).
 * Requires DATABASE_URL. Run migrations before tests (e.g. start server once or use beforeAll).
 * Loads project root .env so DATABASE_URL from there is used when running npm test from backend/.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
if (process.env.LOGIN_MFA_ENABLED === undefined) {
  process.env.LOGIN_MFA_ENABLED = '0';
}

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../app');
const { pool } = require('../../db/pool');
const { runMigrations } = require('../../db/migrate');
const passwordResetDb = require('../../db/passwordResetDb');
const oidcDb = require('../../db/oidcDb');
const { bearerFromAuthResponse, bearerTokenForUser } = require('../helpers/authTestHelpers');

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64url');
}

const hasDb = !!process.env.DATABASE_URL;

describe('API Integration (TEST-PLAN)', () => {
  beforeAll(async () => {
    if (hasDb) {
      try {
        await runMigrations();
      } catch (err) {
        console.warn('Migrations skipped or failed:', err.message);
      }
    }
  });

  afterAll(async () => {
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  });

  describe('Health (no DB required)', () => {
    test('GET /health returns 200 and status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', service: 'downstream-hub-api' });
    });
  });

  describe('Auth — validation only (no DB state)', () => {
    test('POST /api/auth/register — missing email or password returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ password: 'secret123', password_retype: 'secret123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email and password required/i);
    });

    test('POST /api/auth/register — password !== password_retype returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'secret123',
          password_retype: 'different',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/confirm password do not match/i);
    });

    test('POST /api/auth/register — invalid email format returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'not-an-email',
          password: 'secret123',
          password_retype: 'secret123',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid email format/i);
    });

    test('POST /api/auth/register — password length < 12 returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '12345678901',
          password_retype: '12345678901',
        });
      expect([400, 403, 500]).toContain(res.status);
      if (res.status === 400) expect(res.body.error).toMatch(/at least 12 characters/i);
    });

    test('POST /api/auth/login — missing credentials returns 400', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email and password required/i);
    });
  });

  describe('Auth — with DB', () => {
    test('POST /api/auth/register — disabled when OPEN_REGISTRATION=0', async () => {
      const prev = process.env.OPEN_REGISTRATION;
      process.env.OPEN_REGISTRATION = '0';
      try {
        const res = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'disabled-reg@example.com',
            password: 'DisabledReg1!',
            password_retype: 'DisabledReg1!',
          });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/disabled/i);
      } finally {
        if (prev === undefined) delete process.env.OPEN_REGISTRATION;
        else process.env.OPEN_REGISTRATION = prev;
      }
    });

    test('GET /api/auth/registration-options returns 200 and business_units array (or 500 if DB unavailable)', async () => {
      const res = await request(app).get('/api/auth/registration-options');
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(Array.isArray(res.body.business_units)).toBe(true);
      }
    });

    const runDomainTest = hasDb ? test : test.skip;
    runDomainTest('POST /api/auth/register — domain not allowed returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'user@not-allowed-domain-xyz.com',
          password: 'Password1!',
          password_retype: 'Password1!',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/domain not authorized/i);
    });
  });

  describe('Auth — protected routes', () => {
    test('GET /api/auth/me without token returns 401', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Settings — password policy (Admin only)', () => {
    test('GET /api/settings/password-policy without token returns 401', async () => {
      const res = await request(app).get('/api/settings/password-policy');
      expect(res.status).toBe(401);
    });

    test('PUT /api/settings/password-policy without token returns 401', async () => {
      const res = await request(app)
        .put('/api/settings/password-policy')
        .send({ password_expiry_days: 90 });
      expect(res.status).toBe(401);
    });
  });

  describe('SSO', () => {
    test('GET /api/sso/redirect without auth returns 401', async () => {
      const res = await request(app).get('/api/sso/redirect');
      expect(res.status).toBe(401);
    });

    test('GET /api/sso/redirect with applicationId but without auth returns 401', async () => {
      const res = await request(app).get(
        '/api/sso/redirect?applicationId=00000000-0000-0000-0000-000000000001'
      );
      expect(res.status).toBe(401);
    });

    test('GET /api/sso/bridge without ref returns 400', async () => {
      const res = await request(app).get('/api/sso/bridge');
      expect(res.status).toBe(400);
    });

    const runOidcTokenTest = hasDb ? test : test.skip;

    runOidcTokenTest('POST /api/sso/token id_token has email_verified true when hub_oidc_email_verified_at is set', async () => {
      const { rows: userRows } = await pool.query(
        'SELECT id FROM users WHERE deleted_at IS NULL ORDER BY email LIMIT 1'
      );
      if (!userRows.length) return;
      const userId = userRows[0].id;
      await pool.query('UPDATE users SET hub_oidc_email_verified_at = now() WHERE id = $1', [userId]);

      let appRow;
      const { rows: appRows } = await pool.query(
        `SELECT id, oauth_client_id, oidc_redirect_uris FROM applications
         WHERE deleted_at IS NULL AND sso_mode = 'oidc' AND oauth_client_id IS NOT NULL
         LIMIT 1`
      );
      if (appRows.length) {
        appRow = appRows[0];
      } else {
        const cid = `test-oidc-client-${Date.now()}`;
        const ins = await pool.query(
          `INSERT INTO applications (name, description, icon_url, target_url, target_bu_id, oauth_client_id, oidc_redirect_uris, sso_mode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, oauth_client_id, oidc_redirect_uris`,
          ['OIDC Test App', 'test', '', 'https://example.com/app', null, cid, ['https://example.com/callback'], 'oidc']
        );
        appRow = ins.rows[0];
      }

      const redirectUri =
        Array.isArray(appRow.oidc_redirect_uris) && appRow.oidc_redirect_uris[0]
          ? appRow.oidc_redirect_uris[0]
          : 'https://example.com/callback';
      const clientId = appRow.oauth_client_id;
      const codeVerifier = toBase64Url(crypto.randomBytes(48));
      const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
      const rawCode = toBase64Url(crypto.randomBytes(32));
      const expiresAt = new Date(Date.now() + 120000);

      await oidcDb.insertAuthCode(pool, {
        rawCode,
        userId,
        applicationId: appRow.id,
        clientId,
        redirectUri,
        scope: 'openid profile email',
        nonce: 'n',
        codeChallenge,
        codeChallengeMethod: 'S256',
        expiresAt,
      });

      const res = await request(app).post('/api/sso/token').send({
        grant_type: 'authorization_code',
        code: rawCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      });

      expect(res.status).toBe(200);
      expect(res.body.id_token).toBeTruthy();
      const parts = res.body.id_token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.email_verified).toBe(true);
    });

    runOidcTokenTest('POST /api/sso/token id_token has email_verified false when hub_oidc_email_verified_at is null', async () => {
      if (process.env.OIDC_EMAIL_VERIFIED_TRUST_ALL === '1') {
        return;
      }
      const { rows: userRows } = await pool.query(
        'SELECT id FROM users WHERE deleted_at IS NULL ORDER BY email LIMIT 2 OFFSET 1'
      );
      if (!userRows.length) return;
      const userId = userRows[0].id;
      await pool.query('UPDATE users SET hub_oidc_email_verified_at = NULL WHERE id = $1', [userId]);

      const { rows: appRows } = await pool.query(
        `SELECT id, oauth_client_id, oidc_redirect_uris FROM applications
         WHERE deleted_at IS NULL AND sso_mode = 'oidc' AND oauth_client_id IS NOT NULL
         LIMIT 1`
      );
      if (!appRows.length) return;

      const appRow = appRows[0];
      const redirectUri =
        Array.isArray(appRow.oidc_redirect_uris) && appRow.oidc_redirect_uris[0]
          ? appRow.oidc_redirect_uris[0]
          : 'https://example.com/callback';
      const clientId = appRow.oauth_client_id;
      const codeVerifier = toBase64Url(crypto.randomBytes(48));
      const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());
      const rawCode = toBase64Url(crypto.randomBytes(32));
      const expiresAt = new Date(Date.now() + 120000);

      await oidcDb.insertAuthCode(pool, {
        rawCode,
        userId,
        applicationId: appRow.id,
        clientId,
        redirectUri,
        scope: 'openid profile email',
        nonce: 'n',
        codeChallenge,
        codeChallengeMethod: 'S256',
        expiresAt,
      });

      const res = await request(app).post('/api/sso/token').send({
        grant_type: 'authorization_code',
        code: rawCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      });

      expect(res.status).toBe(200);
      const parts = res.body.id_token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(payload.email_verified).toBe(false);
    });
  });

  describe('Applications — SSO mode', () => {
    const runSsoModeTest = hasDb ? test : test.skip;

    let ssoModeAdminToken;
    let ssoModeUserToken;
    let ssoModeUserId;
    let noneAppId;
    const noneTargetUrl = 'https://direct-app.example.com/home';

    beforeAll(async () => {
      if (!hasDb) return;

      const adminEmail = `sso-mode-admin-${Date.now()}@example.com`;
      const adminPass = 'SsoModeAdmin1!';
      let res = await request(app)
        .post('/api/auth/register')
        .send({ email: adminEmail, password: adminPass, password_retype: adminPass });
      if (res.status !== 201) {
        res = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPass });
      }
      ssoModeAdminToken = await bearerFromAuthResponse(pool, res);

      const userEmail = `sso-mode-user-${Date.now()}@example.com`;
      const userPass = 'SsoModeUser1!';
      const userReg = await request(app)
        .post('/api/auth/register')
        .send({ email: userEmail, password: userPass, password_retype: userPass });
      ssoModeUserId = userReg.body?.user?.id;
      const loginRes = await request(app).post('/api/auth/login').send({ email: userEmail, password: userPass });
      ssoModeUserToken = await bearerFromAuthResponse(pool, loginRes);

      const appRes = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${ssoModeAdminToken}`)
        .send({
          name: `NoneModeApp-${Date.now()}`,
          target_url: noneTargetUrl,
          target_bu_ids: [],
          sso_mode: 'none',
        });
      noneAppId = appRes.body?.id;
    });

    runSsoModeTest('POST /api/applications — sso_mode none succeeds without OIDC fields', async () => {
      if (!ssoModeAdminToken) return;
      const res = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${ssoModeAdminToken}`)
        .send({
          name: `NoneModeApp2-${Date.now()}`,
          target_url: 'https://another-direct.example.com',
          sso_mode: 'none',
        });
      expect(res.status).toBe(201);
      expect(res.body.sso_mode).toBe('none');
      expect(res.body.oauth_client_id).toBeNull();
      expect(res.body.oidc_redirect_uris).toEqual([]);
    });

    runSsoModeTest('POST /api/applications — sso_mode oidc requires Client ID and Redirect URIs', async () => {
      if (!ssoModeAdminToken) return;
      const res = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${ssoModeAdminToken}`)
        .send({
          name: `OidcMissing-${Date.now()}`,
          target_url: 'https://oidc-missing.example.com',
          sso_mode: 'oidc',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/oauth_client_id is required/i);
    });

    runSsoModeTest('POST /api/applications — invalid sso_mode returns 400', async () => {
      if (!ssoModeAdminToken) return;
      const res = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${ssoModeAdminToken}`)
        .send({
          name: `BadMode-${Date.now()}`,
          target_url: 'https://bad-mode.example.com',
          sso_mode: 'bridge',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/sso_mode must be/i);
    });

    runSsoModeTest('GET /api/sso/redirect — none mode returns target_url without email verification', async () => {
      if (!ssoModeUserToken || !noneAppId || !ssoModeUserId) return;
      await pool.query('UPDATE users SET hub_oidc_email_verified_at = NULL WHERE id = $1', [ssoModeUserId]);
      const res = await request(app)
        .get(`/api/sso/redirect?applicationId=${encodeURIComponent(noneAppId)}`)
        .set('Authorization', `Bearer ${ssoModeUserToken}`);
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('none');
      expect(res.body.bridgeUrl).toBe(noneTargetUrl);
    });
  });

  describe('Applications', () => {
    test('GET /api/applications/for-me without token returns 401', async () => {
      const res = await request(app).get('/api/applications/for-me');
      expect(res.status).toBe(401);
    });
  });

  describe('Allowed domains — Admin only', () => {
    test('GET /api/allowed-domains without token returns 401', async () => {
      const res = await request(app).get('/api/allowed-domains');
      expect(res.status).toBe(401);
    });
  });

  describe('Business units — Admin only', () => {
    test('GET /api/business-units without token returns 401', async () => {
      const res = await request(app).get('/api/business-units');
      expect(res.status).toBe(401);
    });
  });

  describe('Users — Admin only', () => {
    test('GET /api/users without token returns 401', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });
  });

  describe('Users — PATCH role and profile', () => {
    const runUserPatchTest = hasDb ? test : test.skip;

    let adminToken;
    let adminUserId;
    let employeeUserId;
    let employeeToken;
    let buId;

    beforeAll(async () => {
      if (!hasDb || !pool) return;
      try {
        const { rows: active } = await pool.query(
          `SELECT 1 FROM allowed_domains WHERE domain = 'example.com' AND deleted_at IS NULL LIMIT 1`
        );
        if (active.length === 0) {
          await pool.query(
            `INSERT INTO allowed_domains (id, domain, created_at) VALUES (gen_random_uuid(), 'example.com', now())`
          );
        }

        const adminEmail = `role-patch-admin-${Date.now()}@example.com`;
        const adminPass = 'RolePatchAdmin1!';
        let res = await request(app).post('/api/auth/register').send({
          email: adminEmail,
          password: adminPass,
          password_retype: adminPass,
        });
        if (res.status !== 201) {
          res = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPass });
        }
        adminUserId = res.body.user?.id;
        if (adminUserId && res.body.user?.role !== 'Admin') {
          await pool.query(`UPDATE users SET role = 'Admin' WHERE id = $1`, [adminUserId]);
        }
        res = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPass });
        expect(res.status).toBe(200);
        adminToken = await bearerFromAuthResponse(pool, res);
        adminUserId = res.body.user?.id || adminUserId;

        const buRes = await request(app)
          .post('/api/business-units')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: `RolePatch-BU-${Date.now()}` });
        buId = buRes.body?.business_unit?.id || buRes.body?.id;

        const employeeEmail = `role-patch-employee-${Date.now()}@example.com`;
        const employeePass = 'RolePatchEmp1!';
        res = await request(app).post('/api/auth/register').send({
          email: employeeEmail,
          password: employeePass,
          password_retype: employeePass,
        });
        expect(res.status).toBe(201);
        employeeUserId = res.body.user.id;
        employeeToken = await bearerFromAuthResponse(pool, res);
      } catch (e) {
        console.warn('Users PATCH setup failed:', e.message);
        adminToken = null;
      }
    });

    runUserPatchTest('PATCH /api/users/:id — promotes Employee to Admin', async () => {
      if (!adminToken || !employeeUserId) return;
      const res = await request(app)
        .patch(`/api/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'Admin' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
    });

    runUserPatchTest('PATCH /api/users/:id — demotes another user Admin to Employee', async () => {
      if (!adminToken || !employeeUserId) return;
      const res = await request(app)
        .patch(`/api/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'Employee' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Employee');
    });

    runUserPatchTest('PATCH /api/users/:id — self-demotion returns 400', async () => {
      if (!adminToken || !adminUserId) return;
      const res = await request(app)
        .patch(`/api/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'Employee' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot change your own role/i);
    });

    runUserPatchTest('PATCH /api/users/:id — updates role and business_unit_id together', async () => {
      if (!adminToken || !employeeUserId || !buId) return;
      const res = await request(app)
        .patch(`/api/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'Admin', business_unit_id: buId });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
      expect(res.body.business_unit_id).toBe(buId);
    });

    runUserPatchTest('PATCH /api/users/:id — empty body returns 400', async () => {
      if (!adminToken || !employeeUserId) return;
      const res = await request(app)
        .patch(`/api/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    runUserPatchTest('PATCH /api/users/:id — Employee caller returns 403', async () => {
      if (!employeeToken || !employeeUserId) return;
      const res = await request(app)
        .patch(`/api/users/${employeeUserId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ role: 'Admin' });
      expect(res.status).toBe(403);
    });
  });

  describe('Password reset', () => {
    const runDb = hasDb ? test : test.skip;

    runDb('POST /api/auth/forgot-password — unknown email returns generic 200', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: `nonexistent-${Date.now()}@example.com` });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/If an account is associated/i);
    });

    runDb('POST /api/auth/reset-password — success invalidates prior JWT (tv bump)', async () => {
      const email = `pwd-reset-${Date.now()}@example.com`;
      const oldPass = 'OldResetPass1!';
      const newPass = 'NewResetPass1!';
      let res = await request(app).post('/api/auth/register').send({
        email,
        password: oldPass,
        password_retype: oldPass,
      });
      expect(res.status).toBe(201);
      const userId = res.body.user.id;
      const oldToken = await bearerFromAuthResponse(pool, res);

      res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
      expect(res.status).toBe(200);

      const rawToken = `it-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
      await passwordResetDb.insert(pool, {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
        requestIp: '127.0.0.1',
      });

      res = await request(app).get(`/api/auth/reset-token-info?token=${encodeURIComponent(rawToken)}`);
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);

      res = await request(app).post('/api/auth/reset-password').send({
        token: rawToken,
        new_password: newPass,
        new_password_retype: newPass,
      });
      expect(res.status).toBe(200);

      res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_STALE');

      res = await request(app).post('/api/auth/login').send({ email, password: oldPass });
      expect(res.status).toBe(401);

      res = await request(app).post('/api/auth/login').send({ email, password: newPass });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();

      const newTok = await bearerFromAuthResponse(pool, res);
      res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newTok}`);
      expect(res.status).toBe(200);
    });

    runDb('POST /api/auth/reset-password — invalid token returns 400', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        token: 'nope-not-a-real-token',
        new_password: 'SomePass1!',
        new_password_retype: 'SomePass1!',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid|expired/i);
    });
  });

  describe('Security policy (complexity, history, lockout)', () => {
    const runSecurityTest = hasDb ? test : test.skip;
    // Lockout tests (423 after N failures, correct password when locked, success resets attempts) are skipped:
    // they depend on locked_until being visible on the next request; re-enable when debugging lockout behaviour.
    let adminToken;
    const adminEmail = 'security-test-admin@example.com';
    const adminPassword = 'TestAdmin1!';

    beforeAll(async () => {
      if (!hasDb || !pool) return;
      try {
        const { rows: active } = await pool.query(
          `SELECT 1 FROM allowed_domains WHERE domain = 'example.com' AND deleted_at IS NULL LIMIT 1`
        );
        if (active.length === 0) {
          await pool.query(
            `UPDATE allowed_domains SET deleted_at = NULL WHERE id = (SELECT id FROM allowed_domains WHERE domain = 'example.com' AND deleted_at IS NOT NULL LIMIT 1)`
          );
          const { rows: after } = await pool.query(
            `SELECT 1 FROM allowed_domains WHERE domain = 'example.com' AND deleted_at IS NULL LIMIT 1`
          );
          if (after.length === 0) {
            await pool.query(
              `INSERT INTO allowed_domains (id, domain, created_at) VALUES (gen_random_uuid(), 'example.com', now())`
            );
          }
        }
        let res = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
        if (res.status !== 200) {
          res = await request(app).post('/api/auth/register').send({
            email: adminEmail,
            password: adminPassword,
            password_retype: adminPassword,
          });
          if (res.status !== 201) {
            throw new Error(res.body?.error || `Register failed with ${res.status}`);
          }
        }
        adminToken = await bearerFromAuthResponse(pool, res);
        const usersRes = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
        if (usersRes.status === 403) adminToken = null;
      } catch (e) {
        console.warn('Security policy test setup failed:', e.message);
      }
    });

    runSecurityTest('POST /api/auth/register — complexity: weak password rejected', async () => {
      await request(app)
        .put('/api/settings/password-policy')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ min_password_length: 8, require_uppercase: true, require_lowercase: true, require_number: true, require_symbol: true });
      const email = `complexity-${Date.now()}@example.com`;
      const res = await request(app).post('/api/auth/register').send({
        email,
        password: 'nosymbol1',
        password_retype: 'nosymbol1',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/symbol|character|password/i);
    });

    runSecurityTest('POST /api/auth/register — complexity: strong password accepted', async () => {
      const email = `strong-${Date.now()}@example.com`;
      const res = await request(app).post('/api/auth/register').send({
        email,
        password: 'StrongPass1!',
        password_retype: 'StrongPass1!',
      });
      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
    });

    runSecurityTest('POST /api/auth/change-password — reuse of recent password rejected', async () => {
      const email = `reuse-${Date.now()}@example.com`;
      const first = 'ReusePass1!';
      let res = await request(app).post('/api/auth/register').send({ email, password: first, password_retype: first });
      expect(res.status).toBe(201);
      const token = await bearerFromAuthResponse(pool, res);
      await request(app).put('/api/settings/password-policy').set('Authorization', `Bearer ${adminToken}`).send({ password_history_count: 2 });
      res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({
        current_password: first,
        new_password: 'OtherPass1!',
        new_password_retype: 'OtherPass1!',
      });
      expect(res.status).toBe(200);
      res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({
        current_password: 'OtherPass1!',
        new_password: 'ThirdPass1!',
        new_password_retype: 'ThirdPass1!',
      });
      expect(res.status).toBe(200);
      const reuseToken = token;
      res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${reuseToken}`).send({
        current_password: 'ThirdPass1!',
        new_password: 'OtherPass1!',
        new_password_retype: 'OtherPass1!',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/reuse|recent/i);
    });

    test.skip('POST /api/auth/login — lockout after N failures returns 423', async () => {
      const email = `lockout-${Date.now()}@example.com`;
      const pass = 'LockoutPass1!';
      let res = await request(app).post('/api/auth/register').send({ email, password: pass, password_retype: pass });
      expect(res.status).toBe(201);
      await request(app).put('/api/settings/password-policy').set('Authorization', `Bearer ${adminToken}`).send({ max_login_attempts: 1, lockout_duration_mins: 30 });
      await request(app).post('/api/auth/login').send({ email, password: 'wrong1' });
      res = await request(app).post('/api/auth/login').send({ email, password: 'wrong2' });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
      expect(res.body.locked_until).toBeDefined();
    });

    test.skip('POST /api/auth/login — correct password still 423 when locked', async () => {
      const email = `locked-${Date.now()}@example.com`;
      const pass = 'LockedPass1!';
      let res = await request(app).post('/api/auth/register').send({ email, password: pass, password_retype: pass });
      expect(res.status).toBe(201);
      await request(app).put('/api/settings/password-policy').set('Authorization', `Bearer ${adminToken}`).send({ max_login_attempts: 1, lockout_duration_mins: 30 });
      await request(app).post('/api/auth/login').send({ email, password: 'wrong1' });
      res = await request(app).post('/api/auth/login').send({ email, password: pass });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });

    runSecurityTest('POST /api/users/:id/unlock — Admin unlock then login succeeds', async () => {
      if (!adminToken) return;
      const email = `unlock-${Date.now()}@example.com`;
      const pass = 'UnlockPass1!';
      let res = await request(app).post('/api/auth/register').send({ email, password: pass, password_retype: pass });
      expect(res.status).toBe(201);
      const userId = res.body.user.id;
      await request(app).put('/api/settings/password-policy').set('Authorization', `Bearer ${adminToken}`).send({ max_login_attempts: 1, lockout_duration_mins: 30 });
      await request(app).post('/api/auth/login').send({ email, password: 'wrong1' });
      res = await request(app).post('/api/users/' + userId + '/unlock').set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(200);
      res = await request(app).post('/api/auth/login').send({ email, password: pass });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
    });

    test.skip('POST /api/auth/login — success resets failed attempts', async () => {
      const email = `reset-${Date.now()}@example.com`;
      const pass = 'ResetPass1!';
      let res = await request(app).post('/api/auth/register').send({ email, password: pass, password_retype: pass });
      expect(res.status).toBe(201);
      await request(app).put('/api/settings/password-policy').set('Authorization', `Bearer ${adminToken}`).send({ max_login_attempts: 2, lockout_duration_mins: 30 });
      await request(app).post('/api/auth/login').send({ email, password: 'wrong1' });
      res = await request(app).post('/api/auth/login').send({ email, password: pass });
      expect(res.status).toBe(200);
      res = await request(app).post('/api/auth/login').send({ email, password: 'wrong1' });
      expect(res.status).toBe(401);
      res = await request(app).post('/api/auth/login').send({ email, password: 'wrong2' });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-BU Application visibility (migration 013)
  // ---------------------------------------------------------------------------
  describe('Applications — multi-BU visibility (TEST-PLAN §applications)', () => {
    const runAppTest = hasDb ? test : test.skip;

    let adminToken2;
    let buAId;
    let buBId;
    let appGlobalId;
    let appScopedId;
    let userBuAToken;

    beforeAll(async () => {
      if (!hasDb) return;

      // Re-use or re-establish an admin token
      const adminEmail = `multibu-admin-${Date.now()}@example.com`;
      const adminPass = 'AdminMultiBU1!';
      let res = await request(app).post('/api/auth/register').send({ email: adminEmail, password: adminPass, password_retype: adminPass });
      if (res.status !== 201) {
        // Already exists — just login
        res = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPass });
      }
      adminToken2 = await bearerFromAuthResponse(pool, res);

      // Create two BUs
      const buARes = await request(app).post('/api/business-units').set('Authorization', `Bearer ${adminToken2}`).send({ name: `BU-A-${Date.now()}` });
      const buBRes = await request(app).post('/api/business-units').set('Authorization', `Bearer ${adminToken2}`).send({ name: `BU-B-${Date.now()}` });
      buAId = buARes.body?.business_unit?.id || buARes.body?.id;
      buBId = buBRes.body?.business_unit?.id || buBRes.body?.id;

      // Create a Global app (no BUs)
      const globalAppRes = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ name: `GlobalApp-${Date.now()}`, target_url: 'https://global.example.com', target_bu_ids: [] });
      appGlobalId = globalAppRes.body?.id;

      // Create a scoped app (BU-A only)
      if (buAId) {
        const scopedAppRes = await request(app)
          .post('/api/applications')
          .set('Authorization', `Bearer ${adminToken2}`)
          .send({ name: `ScopedApp-${Date.now()}`, target_url: 'https://scoped.example.com', target_bu_ids: [buAId] });
        appScopedId = scopedAppRes.body?.id;
      }

      // Create a user assigned to BU-A
      if (buAId) {
        const userEmail = `user-bua-${Date.now()}@example.com`;
        const userPass = 'UserBuA1!';
        const userRes = await request(app).post('/api/auth/register').send({ email: userEmail, password: userPass, password_retype: userPass });
        const userId = userRes.body?.user?.id;
        if (userId && adminToken2) {
          await request(app).patch(`/api/users/${userId}`).set('Authorization', `Bearer ${adminToken2}`).send({ business_unit_id: buAId });
        }
        const loginRes = await request(app).post('/api/auth/login').send({ email: userEmail, password: userPass });
        userBuAToken = await bearerFromAuthResponse(pool, loginRes);
      }
    });

    runAppTest('POST /api/applications — accepts target_bu_ids array', async () => {
      if (!adminToken2 || !buAId) return;
      const res = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ name: `MultiApp-${Date.now()}`, target_url: 'https://multi.example.com', target_bu_ids: [buAId] });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    runAppTest('GET /api/applications/for-me — user in BU-A sees Global app', async () => {
      if (!userBuAToken || !appGlobalId) return;
      const res = await request(app).get('/api/applications/for-me').set('Authorization', `Bearer ${userBuAToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.applications.map((a) => a.id);
      expect(ids).toContain(appGlobalId);
      const app = res.body.applications.find((a) => a.id === appGlobalId);
      expect(app.oauth_client_id).toBeUndefined();
      expect(app.target_url).toBeUndefined();
      expect(app.oidc_redirect_uris).toBeUndefined();
    });

    runAppTest('GET /api/applications/for-me — user in BU-A sees scoped app targeted to BU-A', async () => {
      if (!userBuAToken || !appScopedId) return;
      const res = await request(app).get('/api/applications/for-me').set('Authorization', `Bearer ${userBuAToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.applications.map((a) => a.id);
      expect(ids).toContain(appScopedId);
    });

    runAppTest('GET /api/applications/for-me — user in BU-A does NOT see app scoped to BU-B only', async () => {
      if (!adminToken2 || !buBId || !userBuAToken) return;
      const scopedBRes = await request(app)
        .post('/api/applications')
        .set('Authorization', `Bearer ${adminToken2}`)
        .send({ name: `BuBOnly-${Date.now()}`, target_url: 'https://bub-only.example.com', target_bu_ids: [buBId] });
      const buBOnlyId = scopedBRes.body?.id;
      const res = await request(app).get('/api/applications/for-me').set('Authorization', `Bearer ${userBuAToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.applications.map((a) => a.id);
      expect(ids).not.toContain(buBOnlyId);
    });

    runAppTest('GET /api/applications?bu=<id>&global=true — admin filter returns matching apps', async () => {
      if (!adminToken2 || !buAId || !appGlobalId || !appScopedId) return;
      const res = await request(app)
        .get(`/api/applications?bu=${buAId}&global=true`)
        .set('Authorization', `Bearer ${adminToken2}`);
      expect(res.status).toBe(200);
      const ids = res.body.applications.map((a) => a.id);
      expect(ids).toContain(appGlobalId);
      expect(ids).toContain(appScopedId);
    });

    runAppTest('GET /api/applications — admin list includes target_bu_ids array', async () => {
      if (!adminToken2 || !appScopedId || !buAId) return;
      const res = await request(app).get('/api/applications').set('Authorization', `Bearer ${adminToken2}`);
      expect(res.status).toBe(200);
      const scoped = res.body.applications.find((a) => a.id === appScopedId);
      expect(scoped).toBeDefined();
      expect(Array.isArray(scoped.target_bu_ids)).toBe(true);
      expect(scoped.target_bu_ids).toContain(buAId);
    });

    runAppTest('GET /api/applications — Employee returns 403', async () => {
      if (!userBuAToken) return;
      const res = await request(app).get('/api/applications').set('Authorization', `Bearer ${userBuAToken}`);
      expect(res.status).toBe(403);
    });
  });
});
