/**
 * Allowed domains CRUD. Admin only. Used to whitelist email domains for registration.
 * Delete is soft (deleted_at). Data access via allowedDomainsDb (excludes soft-deleted).
 */
const express = require('express');
const { pool } = require('../db/pool');
const allowedDomainsDb = require('../db/allowedDomainsDb');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();

function normalizeDomain(domain) {
  if (typeof domain !== 'string' || !domain.trim()) return null;
  return domain.trim().toLowerCase().replace(/^@+/, '');
}

// GET /api/allowed-domains — list all (Admin only)
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = await allowedDomainsDb.list(pool);
    res.json({ allowed_domains: rows });
  } catch (err) {
    console.error('List allowed domains error:', err);
    res.status(500).json({ error: 'Failed to list allowed domains' });
  }
});

// POST /api/allowed-domains — add domain (Admin only)
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required (e.g. example.com)' });
  }
  const client = await pool.connect();
  try {
    const row = await allowedDomainsDb.create(client, domain);
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'CREATE',
      targetEntity: `allowed_domain:${row.domain}`,
      payloadBefore: null,
      payloadAfter: row,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Domain already in whitelist' });
    console.error('Create allowed domain error:', err);
    res.status(500).json({ error: 'Failed to add domain' });
  } finally {
    client.release();
  }
});

// PUT /api/allowed-domains/:id — update domain (Admin only)
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) {
    return res.status(400).json({ error: 'Domain is required (e.g. example.com)' });
  }
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const before = await allowedDomainsDb.getById(client, id);
    if (!before) {
      return res.status(404).json({ error: 'Allowed domain not found' });
    }
    const row = await allowedDomainsDb.update(client, id, domain);
    if (!row) {
      return res.status(404).json({ error: 'Allowed domain not found' });
    }
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'UPDATE',
      targetEntity: `allowed_domain:${row.domain}`,
      payloadBefore: before,
      payloadAfter: row,
      ipAddress: getClientIp(req),
    });
    res.json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Domain already in whitelist' });
    console.error('Update allowed domain error:', err);
    res.status(500).json({ error: 'Failed to update domain' });
  } finally {
    client.release();
  }
});

// DELETE /api/allowed-domains/:id — remove domain (Admin only, soft delete). Prevent deleting last domain.
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const n = await allowedDomainsDb.countActive(pool);
    if (n <= 1) {
      return res.status(400).json({
        error: 'Cannot delete the last allowed domain. Add another domain first to avoid lockout.',
      });
    }
    const before = await allowedDomainsDb.getById(client, id);
    if (!before) {
      return res.status(404).json({ error: 'Allowed domain not found' });
    }
    const ok = await allowedDomainsDb.softDelete(client, id);
    if (!ok) {
      return res.status(404).json({ error: 'Allowed domain not found' });
    }
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'DELETE',
      targetEntity: `allowed_domain:${before.domain}`,
      payloadBefore: before,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.status(204).send();
  } catch (err) {
    console.error('Delete allowed domain error:', err);
    res.status(500).json({ error: 'Failed to delete domain' });
  } finally {
    client.release();
  }
});

module.exports = router;
