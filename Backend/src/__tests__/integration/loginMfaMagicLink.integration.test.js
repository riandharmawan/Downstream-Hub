/**
 * Integration tests for login MFA magic link flow.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
process.env.LOGIN_MFA_ENABLED = '1';
process.env.LOGIN_MAGIC_LINK_TTL_MINUTES = '15';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../app');
const { pool } = require('../../db/pool');
const { runMigrations } = require('../../db/migrate');
const magicLinkDb = require('../../db/magicLinkDb');
const passwordPolicyDb = require('../../db/passwordPolicyDb');
const deviceTrust = require('../../lib/deviceTrust');

const hasDb = !!process.env.DATABASE_URL;

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

async function ensureExampleDomain() {
  const { rows } = await pool.query(
    `SELECT 1 FROM allowed_domains WHERE domain = 'example.com' AND deleted_at IS NULL LIMIT 1`
  );
  if (rows.length === 0) {
    await pool.query(
      `INSERT INTO allowed_domains (id, domain, created_at) VALUES (gen_random_uuid(), 'example.com', now())`
    );
  }
}

async function registerUser(email, password) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password, password_retype: password });
  expect(res.status).toBe(201);
  return res.body.user;
}

async function insertKnownMagicLink(userId, rawToken) {
  await magicLinkDb.invalidatePendingForUser(pool, userId);
  await magicLinkDb.insert(pool, {
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    requestIp: '127.0.0.1',
    pendingLoginHash: hashToken(crypto.randomUUID()),
  });
}

describe('Login MFA magic link', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    await runMigrations();
    await ensureExampleDomain();
  });

  afterAll(async () => {
    if (pool && typeof pool.end === 'function') await pool.end();
  });

  const runTest = hasDb ? test : test.skip;

  runTest('POST /login without trusted device returns magic_link_required', async () => {
    const email = `magic-mfa-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    await registerUser(email, password);

    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(202);
    expect(res.body.magic_link_required).toBe(true);
    expect(res.body.pending_id).toBeTruthy();
    expect(res.body.token).toBeUndefined();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  runTest('POST /magic-link/verify succeeds when password expiry policy is enabled', async () => {
    await passwordPolicyDb.update(pool, { password_expiry_days: 90 });

    const email = `magic-expiry-policy-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await insertKnownMagicLink(user.id, rawToken);

    const verify = await request(app).post('/api/auth/magic-link/verify').send({ token: rawToken });
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe(email);

    await passwordPolicyDb.update(pool, { password_expiry_days: 0 });
  });

  runTest('POST /magic-link/verify issues session and hub_device cookie', async () => {
    const email = `magic-verify-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await insertKnownMagicLink(user.id, rawToken);

    const agent = request.agent(app);
    const info = await agent.get(`/api/auth/magic-link/token-info?token=${encodeURIComponent(rawToken)}`);
    expect(info.status).toBe(200);
    expect(info.body.valid).toBe(true);

    const verify = await agent.post('/api/auth/magic-link/verify').send({ token: rawToken });
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe(email);
    expect(verify.body.token).toBeUndefined();

    const cookies = verify.headers['set-cookie'] || [];
    const deviceCookie = cookies.find((c) => c.startsWith(`${deviceTrust.DEVICE_COOKIE}=`) || c.startsWith('hub_device='));
    expect(deviceCookie).toBeTruthy();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
  });

  runTest('second login on trusted device bypasses magic link within window', async () => {
    const email = `magic-bypass-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await insertKnownMagicLink(user.id, rawToken);

    const agent = request.agent(app);
    await agent.post('/api/auth/magic-link/verify').send({ token: rawToken });

    const login = await agent.post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.user).toBeTruthy();
    expect(login.body.token).toBeUndefined();
    expect(login.body.magic_link_required).toBeUndefined();
  });

  runTest('login without device cookie requires magic link again', async () => {
    const email = `magic-nocookie-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await insertKnownMagicLink(user.id, rawToken);

    const trustedAgent = request.agent(app);
    await trustedAgent.post('/api/auth/magic-link/verify').send({ token: rawToken });
    const bypass = await trustedAgent.post('/api/auth/login').send({ email, password });
    expect(bypass.status).toBe(200);

    const freshAgent = request.agent(app);
    const res = await freshAgent.post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(202);
    expect(res.body.magic_link_required).toBe(true);
  });

  runTest('reused magic link token is rejected', async () => {
    const email = `magic-reuse-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await insertKnownMagicLink(user.id, rawToken);

    const agent = request.agent(app);
    const first = await agent.post('/api/auth/magic-link/verify').send({ token: rawToken });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/magic-link/verify').send({ token: rawToken });
    expect(second.status).toBe(400);
  });

  runTest('expired magic link token is rejected', async () => {
    const email = `magic-expired-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);
    const rawToken = crypto.randomBytes(32).toString('base64url');
    await magicLinkDb.invalidatePendingForUser(pool, user.id);
    await magicLinkDb.insert(pool, {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 60 * 1000),
      requestIp: null,
      pendingLoginHash: null,
    });

    const res = await request(app).post('/api/auth/magic-link/verify').send({ token: rawToken });
    expect(res.status).toBe(400);
  });

  runTest('calendar_day bypass mode resets after midnight UTC', async () => {
    await passwordPolicyDb.update(pool, {
      login_mfa_bypass_mode: 'calendar_day',
      login_mfa_bypass_timezone: 'UTC',
    });

    const email = `magic-cal-${Date.now()}@example.com`;
    const password = 'MagicMfaPass1!';
    const user = await registerUser(email, password);

    const deviceHash = hashToken('test-device-cal');
    await pool.query(
      `INSERT INTO trusted_devices (user_id, device_hash, first_ip, last_ip, expires_at, last_verified_at)
       VALUES ($1, $2, '127.0.0.1', '127.0.0.1', now() + interval '90 days', $3)
       ON CONFLICT (user_id, device_hash) WHERE revoked_at IS NULL
       DO UPDATE SET last_verified_at = EXCLUDED.last_verified_at`,
      [user.id, deviceHash, new Date('2026-08-05T12:00:00.000Z')]
    );

    const policy = await passwordPolicyDb.get(pool);
    const device = { last_verified_at: new Date('2026-08-05T12:00:00.000Z') };
    expect(deviceTrust.isWithinBypassWindow(device, policy, new Date('2026-08-05T23:00:00.000Z'))).toBe(true);
    expect(deviceTrust.isWithinBypassWindow(device, policy, new Date('2026-08-06T01:00:00.000Z'))).toBe(false);

    await passwordPolicyDb.update(pool, { login_mfa_bypass_mode: 'rolling_24h' });
  });
});
