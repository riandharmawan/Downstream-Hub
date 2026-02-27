/**
 * Settings: password policy (Admin only). Used for password expiry configuration.
 */
const express = require('express');
const { pool } = require('../db/pool');
const passwordPolicyDb = require('../db/passwordPolicyDb');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();

// GET /api/settings/password-policy — Admin only
router.get('/password-policy', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const policy = await passwordPolicyDb.get(pool);
    res.json({ password_expiry_days: policy.password_expiry_days });
  } catch (err) {
    console.error('Get password policy error:', err);
    res.status(500).json({ error: 'Failed to load password policy' });
  }
});

// PUT /api/settings/password-policy — Admin only
router.put('/password-policy', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { password_expiry_days } = req.body || {};
    const days = parseInt(String(password_expiry_days), 10);
    if (Number.isNaN(days) || days < 0 || days > 365) {
      return res.status(400).json({ error: 'password_expiry_days must be between 0 and 365' });
    }
    const client = await pool.connect();
    try {
      const before = await passwordPolicyDb.get(client);
      const after = await passwordPolicyDb.update(client, { password_expiry_days: days });
      await auditLog(client, {
        actorId: req.user.id,
        actionType: 'UPDATE',
        targetEntity: 'password_policy',
        payloadBefore: before,
        payloadAfter: after,
        ipAddress: getClientIp(req),
      });
      res.json({ password_expiry_days: after.password_expiry_days });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update password policy error:', err);
    res.status(500).json({ error: 'Failed to update password policy' });
  }
});

module.exports = router;
