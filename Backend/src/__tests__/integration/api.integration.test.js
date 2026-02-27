/**
 * Integration tests for Downstream Hub API (TEST-PLAN §3).
 * Requires DATABASE_URL. Run migrations before tests (e.g. start server once or use beforeAll).
 */
const request = require('supertest');
const app = require('../../app');
const { pool } = require('../../db/pool');
const { runMigrations } = require('../../db/migrate');

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

    test('POST /api/auth/register — password length < 6 returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '12345',
          password_retype: '12345',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least 6 characters/i);
    });

    test('POST /api/auth/login — missing credentials returns 400', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email and password required/i);
    });
  });

  describe('Auth — with DB', () => {
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
          password: 'password123',
          password_retype: 'password123',
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
});
