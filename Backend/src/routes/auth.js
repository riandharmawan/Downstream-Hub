/**
 * Auth: register, login.
 * Uses usersDb and allowedDomainsDb (excludes soft-deleted).
 * Rate limiting applied to login and register to reduce brute-force and abuse.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const allowedDomainsDb = require('../db/allowedDomainsDb');
const businessUnitsDb = require('../db/businessUnitsDb');
const passwordPolicyDb = require('../db/passwordPolicyDb');
const passwordHistoryDb = require('../db/passwordHistoryDb');
const usersDb = require('../db/usersDb');
const { validatePassword } = require('../lib/passwordValidation');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
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
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
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
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
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
