/**
 * Auth: register, login.
 * Uses usersDb and allowedDomainsDb (excludes soft-deleted).
 * Rate limiting applied to login and register to reduce brute-force and abuse.
 */
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const ipKeyGenerator = rateLimit.ipKeyGenerator;
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const allowedDomainsDb = require('../db/allowedDomainsDb');
const businessUnitsDb = require('../db/businessUnitsDb');
const passwordPolicyDb = require('../db/passwordPolicyDb');
const passwordHistoryDb = require('../db/passwordHistoryDb');
const passwordResetDb = require('../db/passwordResetDb');
const usersDb = require('../db/usersDb');
const { validatePassword } = require('../lib/passwordValidation');
const { signAccessToken } = require('../lib/authToken');
const { authMiddleware } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');
const mailer = require('../lib/mailer');

const router = express.Router();

const FORGOT_PASSWORD_MESSAGE =
  'If an account is associated with this email, you will receive instructions shortly.';

const isTest = process.env.NODE_ENV === 'test';
const loginLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '900000', 10),
  max: isTest ? 10000 : Math.max(1, parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '20', 10)),
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || '900000', 10),
  max: isTest ? 10000 : Math.max(1, parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '5', 10)),
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS || '900000', 10),
  max: isTest ? 10000 : Math.max(1, parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX || '5', 10)),
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const rawIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const ip = ipKeyGenerator(rawIp);
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    return `${ip}:${email || 'no-email'}`;
  },
});

// GET /api/auth/registration-options — public; returns BUs for registration dropdown
router.get('/registration-options', async (req, res) => {
  try {
    const business_units = await businessUnitsDb.list(pool);
    res.json({ business_units });
  } catch (err) {
    console.error('Registration options error:', err);
    res.status(500).json({ error: 'Failed to load registration options' });
  }
});

// POST /api/auth/register
router.post('/register', registerLimit, async (req, res) => {
  try {
    const { email, password, password_retype, business_unit_id } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (password !== password_retype) {
      return res.status(400).json({ error: 'Password and confirm password do not match' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    const policy = await passwordPolicyDb.get(pool);
    const pv = validatePassword(password, policy);
    if (!pv.valid) {
      return res.status(400).json({ error: pv.error });
    }
    const domain = emailNorm.split('@')[1];
    if (!domain) {
      return res.status(400).json({ error: 'Email domain not authorized.' });
    }
    const domainRow = await allowedDomainsDb.getByDomain(pool, domain);
    if (!domainRow) {
      return res.status(400).json({ error: 'Email domain not authorized.' });
    }
    let buId = null;
    if (business_unit_id != null && business_unit_id !== '') {
      const bu = await businessUnitsDb.getById(pool, business_unit_id);
      if (!bu) {
        return res.status(400).json({ error: 'Invalid business unit' });
      }
      buId = bu.id;
    }
    const password_hash = await bcrypt.hash(password, 10);
    const n = await usersDb.countActive(pool);
    const role = n === 0 ? 'Admin' : 'Employee';
    const user = await usersDb.create(pool, { email: emailNorm, password_hash, role, business_unit_id: buId });
    const token = signAccessToken(user);
    res.status(201).json({ user: { id: user.id, email: user.email, role: user.role, business_unit_id: user.business_unit_id }, token });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const user = await usersDb.getByEmail(pool, emailNorm);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const policy = await passwordPolicyDb.get(pool);
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Account locked', code: 'ACCOUNT_LOCKED', locked_until: user.locked_until });
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      await usersDb.incrementFailedLogin(pool, user.id, policy.max_login_attempts, policy.lockout_duration_mins);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    await usersDb.resetFailedLogin(pool, user.id);
    if (policy.password_expiry_days > 0) {
      const changedAt = user.password_changed_at ? new Date(user.password_changed_at).getTime() : 0;
      const expiryMs = policy.password_expiry_days * 24 * 60 * 60 * 1000;
      if (!changedAt || Date.now() - changedAt > expiryMs) {
        return res.status(403).json({ error: 'Password expired', code: 'PASSWORD_EXPIRED' });
      }
    }
    const token = signAccessToken(user);
    const client = await pool.connect();
    try {
      await auditLog(client, {
        actorId: user.id,
        actionType: 'LOGIN',
        targetEntity: user.email,
        payloadBefore: null,
        payloadAfter: null,
        ipAddress: getClientIp(req),
      });
    } finally {
      client.release();
    }
    res.json({ user: { id: user.id, email: user.email, role: user.role, business_unit_id: user.business_unit_id }, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/change-password-expired — no auth; for users blocked by password expiry
router.post('/change-password-expired', async (req, res) => {
  try {
    const { email, current_password, new_password, new_password_retype } = req.body || {};
    if (!email || !current_password || !new_password || !new_password_retype) {
      return res.status(400).json({ error: 'Email, current password, new password and confirm are required' });
    }
    if (new_password !== new_password_retype) {
      return res.status(400).json({ error: 'New password and confirm do not match' });
    }
    const policy = await passwordPolicyDb.get(pool);
    const pv = validatePassword(new_password, policy);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const emailNorm = String(email).trim().toLowerCase();
    const user = await usersDb.getByEmail(pool, emailNorm);
    if (!user || !(await bcrypt.compare(current_password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or current password' });
    }
    if (policy.password_expiry_days <= 0) {
      return res.status(400).json({ error: 'Password expiry is not enabled' });
    }
    const changedAt = user.password_changed_at ? new Date(user.password_changed_at).getTime() : 0;
    const expiryMs = policy.password_expiry_days * 24 * 60 * 60 * 1000;
    if (changedAt && Date.now() - changedAt <= expiryMs) {
      return res.status(400).json({ error: 'Password is not expired; use normal login' });
    }
    if (policy.password_history_count > 0) {
      if (await bcrypt.compare(new_password, user.password_hash)) {
        return res.status(400).json({ error: 'Cannot reuse a recent password' });
      }
      const history = await passwordHistoryDb.getHashesForUser(pool, user.id, policy.password_history_count);
      for (const row of history) {
        if (await bcrypt.compare(new_password, row.password_hash)) {
          return res.status(400).json({ error: 'Cannot reuse a recent password' });
        }
      }
      const currentHash = user.password_hash;
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(pool, user.id, password_hash);
      await passwordHistoryDb.add(pool, user.id, currentHash);
      await passwordHistoryDb.trimToLimit(pool, user.id, policy.password_history_count);
    } else {
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(pool, user.id, password_hash);
    }
    const tv = await usersDb.getTokenVersion(pool, user.id);
    const token = signAccessToken({ id: user.id, email: user.email, role: user.role, token_version: tv });
    const client = await pool.connect();
    try {
      await auditLog(client, {
        actorId: user.id,
        actionType: 'PASSWORD_CHANGE',
        targetEntity: `user:${user.email}`,
        payloadBefore: null,
        payloadAfter: null,
        ipAddress: getClientIp(req),
      });
    } finally {
      client.release();
    }
    res.json({ message: 'Password updated', token, user: { id: user.id, email: user.email, role: user.role, business_unit_id: user.business_unit_id } });
  } catch (err) {
    console.error('Change password expired error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// POST /api/auth/change-password — authenticated user changes own password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password, new_password_retype } = req.body || {};
    if (!current_password || !new_password || !new_password_retype) {
      return res.status(400).json({ error: 'Current password, new password and confirm are required' });
    }
    if (new_password !== new_password_retype) {
      return res.status(400).json({ error: 'New password and confirm do not match' });
    }
    const policy = await passwordPolicyDb.get(pool);
    const pv = validatePassword(new_password, policy);
    if (!pv.valid) return res.status(400).json({ error: pv.error });
    const user = await usersDb.getByEmail(pool, req.user.email);
    if (!user || !(await bcrypt.compare(current_password, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (policy.password_history_count > 0) {
      const history = await passwordHistoryDb.getHashesForUser(pool, req.user.id, policy.password_history_count);
      for (const row of history) {
        if (await bcrypt.compare(new_password, row.password_hash)) {
          return res.status(400).json({ error: 'Cannot reuse a recent password' });
        }
      }
      if (await bcrypt.compare(new_password, user.password_hash)) {
        return res.status(400).json({ error: 'Cannot reuse a recent password' });
      }
      const currentHash = user.password_hash;
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(pool, req.user.id, password_hash);
      await passwordHistoryDb.add(pool, req.user.id, currentHash);
      await passwordHistoryDb.trimToLimit(pool, req.user.id, policy.password_history_count);
    } else {
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(pool, req.user.id, password_hash);
    }
    const client = await pool.connect();
    try {
      await auditLog(client, {
        actorId: req.user.id,
        actionType: 'PASSWORD_CHANGE',
        targetEntity: `user:${req.user.email}`,
        payloadBefore: null,
        payloadAfter: null,
        ipAddress: getClientIp(req),
      });
    } finally {
      client.release();
    }
    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// GET /api/auth/reset-token-info?token= — public; does not reveal user identity
router.get('/reset-token-info', async (req, res) => {
  try {
    const raw = req.query.token;
    if (!raw || typeof raw !== 'string') {
      return res.json({ valid: false });
    }
    const tokenHash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    const row = await passwordResetDb.findActiveByHash(pool, tokenHash);
    if (!row) return res.json({ valid: false });
    if (new Date(row.expires_at) < new Date()) return res.json({ valid: false });
    return res.json({ valid: true });
  } catch (err) {
    console.error('Reset token info error:', err);
    return res.json({ valid: false });
  }
});

// POST /api/auth/forgot-password — generic response; rate limited (IP + email)
router.post('/forgot-password', forgotPasswordLimit, async (req, res) => {
  try {
    const raw = req.body?.email;
    const emailNorm = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const ip = getClientIp(req);

    if (process.env.NODE_ENV === 'development') {
      console.info('[auth] forgot-password: request received');
    }

    if (emailNorm && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      const user = await usersDb.getByEmail(pool, emailNorm);
      if (user) {
        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
        const ttlMin = Math.max(5, Math.min(120, parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10)));
        const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);
        await passwordResetDb.insert(pool, {
          userId: user.id,
          tokenHash,
          expiresAt,
          requestIp: ip,
        });
        const publicBase = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(
          /\/$/,
          ''
        );
        const resetUrl = `${publicBase}/reset-password?token=${encodeURIComponent(rawToken)}`;
        try {
          await mailer.sendPasswordResetEmail({ to: emailNorm, resetUrl });
        } catch (mailErr) {
          console.error('Password reset email error:', mailErr.message);
        }
        const client = await pool.connect();
        try {
          await auditLog(client, {
            actorId: null,
            actionType: 'PASSWORD_RESET_REQUEST',
            targetEntity: `email:${emailNorm}`,
            payloadBefore: null,
            payloadAfter: null,
            ipAddress: ip,
          });
        } finally {
          client.release();
        }
      } else if (process.env.FORGOT_PASSWORD_DEBUG === '1') {
        console.info('[auth] forgot-password: no user in DB for this email (no mail sent; response is still generic)');
      }
    }
    return res.status(200).json({ message: FORGOT_PASSWORD_MESSAGE });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(200).json({ message: FORGOT_PASSWORD_MESSAGE });
  }
});

// POST /api/auth/reset-password — no auth; does not return session token
router.post('/reset-password', async (req, res) => {
  const { token: rawToken, new_password, new_password_retype } = req.body || {};
  if (!rawToken || typeof rawToken !== 'string') {
    return res.status(400).json({ error: 'Reset token required' });
  }
  if (!new_password || !new_password_retype) {
    return res.status(400).json({ error: 'New password and confirmation are required' });
  }
  if (new_password !== new_password_retype) {
    return res.status(400).json({ error: 'New password and confirm do not match' });
  }

  const client = await pool.connect();
  try {
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    await client.query('BEGIN');
    const row = await passwordResetDb.findActiveByHash(client, tokenHash);
    if (!row || new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      const ip = getClientIp(req);
      const ac = await pool.connect();
      try {
        await auditLog(ac, {
          actorId: null,
          actionType: 'PASSWORD_RESET_FAIL',
          targetEntity: 'reset-password',
          payloadBefore: null,
          payloadAfter: null,
          ipAddress: ip,
        });
      } catch {
        /* ignore */
      } finally {
        ac.release();
      }
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const user = await usersDb.getById(client, row.user_id);
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const policy = await passwordPolicyDb.get(client);
    const pv = validatePassword(new_password, policy);
    if (!pv.valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: pv.error });
    }

    if (policy.password_history_count > 0) {
      const fullUser = await usersDb.getByEmail(client, user.email);
      if (await bcrypt.compare(new_password, fullUser.password_hash)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot reuse a recent password' });
      }
      const history = await passwordHistoryDb.getHashesForUser(client, user.id, policy.password_history_count);
      for (const h of history) {
        if (await bcrypt.compare(new_password, h.password_hash)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Cannot reuse a recent password' });
        }
      }
      const currentHash = fullUser.password_hash;
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(client, user.id, password_hash);
      await passwordHistoryDb.add(client, user.id, currentHash);
      await passwordHistoryDb.trimToLimit(client, user.id, policy.password_history_count);
    } else {
      const password_hash = await bcrypt.hash(new_password, 10);
      await usersDb.updatePassword(client, user.id, password_hash);
    }

    await passwordResetDb.markUsed(client, row.id);
    await passwordResetDb.invalidatePendingForUser(client, user.id);
    await client.query('COMMIT');

    const ip = getClientIp(req);
    const logClient = await pool.connect();
    try {
      await auditLog(logClient, {
        actorId: user.id,
        actionType: 'PASSWORD_RESET_COMPLETE',
        targetEntity: `user:${user.email}`,
        payloadBefore: null,
        payloadAfter: null,
        ipAddress: ip,
      });
    } finally {
      logClient.release();
    }

    try {
      await mailer.sendPasswordChangedEmail({ to: user.email });
    } catch (mailErr) {
      console.error('Password changed email error:', mailErr.message);
    }

    return res.json({
      message: 'Password updated. Please sign in with your new password.',
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  } finally {
    client.release();
  }
});

// GET /api/auth/me (current user with fresh BU from DB)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await usersDb.getByIdWithBuName(pool, req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        business_unit_id: user.business_unit_id,
        business_unit_name: user.business_unit_name,
      },
    });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

module.exports = router;
