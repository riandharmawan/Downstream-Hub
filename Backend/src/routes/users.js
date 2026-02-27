/**
 * User list, manual create, BU assignment, deactivate, reset password. Admin only.
 * Data access via usersDb (excludes soft-deleted users).
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const usersDb = require('../db/usersDb');
const businessUnitsDb = require('../db/businessUnitsDb');
const allowedDomainsDb = require('../db/allowedDomainsDb');
const passwordPolicyDb = require('../db/passwordPolicyDb');
const passwordHistoryDb = require('../db/passwordHistoryDb');
const { validatePassword } = require('../lib/passwordValidation');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();

/** Generate a high-entropy random password (20 chars, alphanumeric + safe symbols). */
function generateRandomPassword() {
  const length = 20;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = crypto.randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

// GET /api/users — list all users with BU (Admin only)
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = await usersDb.listWithBu(pool);
    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      business_unit_id: r.business_unit_id,
      business_unit_name: r.business_unit_name || null,
      created_at: r.created_at,
      locked_until: r.locked_until || null,
    }));
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users — manual user creation (Admin only)
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { email, password, password_retype, role, business_unit_id } = req.body || {};
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
    const validRoles = ['Admin', 'Employee'];
    const roleVal = role != null && role !== '' ? String(role) : 'Employee';
    if (!validRoles.includes(roleVal)) {
      return res.status(400).json({ error: 'role must be Admin or Employee' });
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
        return res.status(400).json({ error: 'Business unit not found' });
      }
      buId = bu.id;
    }
    const password_hash = await bcrypt.hash(password, 10);
    const user = await usersDb.create(pool, { email: emailNorm, password_hash, role: roleVal, business_unit_id: buId });
    await auditLog(pool, {
      actorId: req.user.id,
      actionType: 'CREATE',
      targetEntity: `user:${user.email}`,
      payloadBefore: null,
      payloadAfter: { id: user.id, email: user.email, role: user.role, business_unit_id: user.business_unit_id },
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ user: { id: user.id, email: user.email, role: user.role, business_unit_id: user.business_unit_id, created_at: user.created_at } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /api/users/:id/unlock — clear lock state (Admin only); must be before PATCH /:id
router.post('/:id/unlock', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await usersDb.getById(pool, id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await usersDb.unlockUser(pool, id);
    await auditLog(pool, {
      actorId: req.user.id,
      actionType: 'UNLOCK',
      targetEntity: `user:${user.email}`,
      payloadBefore: null,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.json({ message: 'Account unlocked' });
  } catch (err) {
    console.error('Unlock user error:', err);
    res.status(500).json({ error: 'Failed to unlock user' });
  }
});

// POST /api/users/:id/deactivate — soft-delete user (Admin only); must be before PATCH /:id
router.post('/:id/deactivate', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const before = await usersDb.getById(pool, id);
    if (!before) {
      return res.status(404).json({ error: 'User not found' });
    }
    const ok = await usersDb.softDelete(pool, id);
    if (!ok) {
      return res.status(404).json({ error: 'User not found' });
    }
    await auditLog(pool, {
      actorId: req.user.id,
      actionType: 'DEACTIVATE',
      targetEntity: `user:${before.email}`,
      payloadBefore: before,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error('Deactivate user error:', err);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// POST /api/users/:id/reset-password — set random password, return it for admin to copy (Admin only)
router.post('/:id/reset-password', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const before = await usersDb.getById(pool, id);
    if (!before) {
      return res.status(404).json({ error: 'User not found' });
    }
    const temporaryPassword = generateRandomPassword();
    const password_hash = await bcrypt.hash(temporaryPassword, 10);
    await usersDb.updatePassword(pool, id, password_hash);
    await passwordHistoryDb.deleteForUser(pool, id);
    await auditLog(pool, {
      actorId: req.user.id,
      actionType: 'PASSWORD_RESET',
      targetEntity: `user:${before.email}`,
      payloadBefore: null,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.json({ message: 'Password reset', temporary_password: temporaryPassword });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// PATCH /api/users/:id — update user's business_unit_id (Admin only)
router.patch('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { business_unit_id } = req.body || {};
  const buId = business_unit_id === null || business_unit_id === undefined || business_unit_id === ''
    ? null
    : business_unit_id;
  if (buId !== null && typeof buId !== 'string') {
    return res.status(400).json({ error: 'business_unit_id must be a UUID or null' });
  }
  const client = await pool.connect();
  try {
    const before = await usersDb.getById(client, id);
    if (!before) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (buId !== null) {
      const bu = await businessUnitsDb.getById(client, buId);
      if (!bu) {
        return res.status(400).json({ error: 'Business unit not found' });
      }
    }
    const row = await usersDb.updateBusinessUnit(client, id, buId);
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'UPDATE',
      targetEntity: `user:${row.email}`,
      payloadBefore: before,
      payloadAfter: row,
      ipAddress: getClientIp(req),
    });
    res.json(row);
  } catch (err) {
    console.error('Update user BU error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  } finally {
    client.release();
  }
});

module.exports = router;
