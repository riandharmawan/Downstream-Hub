/**
 * Applications CRUD. List for all authenticated; create/update/delete for Admin only.
 * Delete is soft (deleted_at). Data access via applicationsDb (excludes soft-deleted).
 */
const express = require('express');
const { pool } = require('../db/pool');
const applicationsDb = require('../db/applicationsDb');
const businessUnitsDb = require('../db/businessUnitsDb');
const usersDb = require('../db/usersDb');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();

const URL_REGEX = /^https?:\/\/[^\s]+$/i;

function validateAppBody(body) {
  const { name, description, icon_url, target_url, target_bu_id } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return { error: 'Name is required' };
  if (!target_url || typeof target_url !== 'string' || !target_url.trim()) return { error: 'Target URL is required' };
  if (!URL_REGEX.test(target_url.trim())) return { error: 'Target URL must be a valid http(s) URL' };
  const buId = target_bu_id === null || target_bu_id === undefined || target_bu_id === '' ? null : target_bu_id;
  return {
    name: name.trim(),
    description: description != null ? String(description).trim() : '',
    icon_url: icon_url != null ? String(icon_url).trim() : '',
    target_url: target_url.trim(),
    target_bu_id: buId,
  };
}

// GET /api/applications/for-me — list apps for current user's BU or Global (authenticated)
router.get('/for-me', authMiddleware, async (req, res) => {
  try {
    const user = await usersDb.getById(pool, req.user.id);
    const buId = user?.business_unit_id ?? null;
    const applications = await applicationsDb.listActive(pool, buId);
    res.json({ applications });
  } catch (err) {
    console.error('List applications for-me error:', err);
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// GET /api/applications — list all (authenticated; Admin uses for full catalog)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await applicationsDb.listAllWithBuName(pool);
    res.json({ applications: rows });
  } catch (err) {
    console.error('List applications error:', err);
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// GET /api/applications/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const app = await applicationsDb.getById(pool, req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (err) {
    console.error('Get application error:', err);
    res.status(500).json({ error: 'Failed to get application' });
  }
});

// POST /api/applications — Admin only
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  const validated = validateAppBody(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (validated.target_bu_id) {
    const bu = await businessUnitsDb.getById(pool, validated.target_bu_id);
    if (!bu) return res.status(400).json({ error: 'Business unit not found' });
  }
  const client = await pool.connect();
  try {
    const app = await applicationsDb.create(client, validated);
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'CREATE',
      targetEntity: app.name,
      payloadBefore: null,
      payloadAfter: app,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(app);
  } catch (err) {
    console.error('Create application error:', err);
    res.status(500).json({ error: 'Failed to create application' });
  } finally {
    client.release();
  }
});

// PUT /api/applications/:id — Admin only
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const validated = validateAppBody(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (validated.target_bu_id) {
    const bu = await businessUnitsDb.getById(pool, validated.target_bu_id);
    if (!bu) return res.status(400).json({ error: 'Business unit not found' });
  }
  const client = await pool.connect();
  try {
    const before = await applicationsDb.getByIdForUpdate(client, req.params.id);
    if (!before) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    const app = await applicationsDb.update(client, req.params.id, validated);
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'UPDATE',
      targetEntity: app.name,
      payloadBefore: before,
      payloadAfter: app,
      ipAddress: getClientIp(req),
    });
    res.json(app);
  } catch (err) {
    console.error('Update application error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  } finally {
    client.release();
  }
});

// DELETE /api/applications/:id — Admin only (soft delete)
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const before = await applicationsDb.getByIdForUpdate(client, req.params.id);
    if (!before) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    const ok = await applicationsDb.softDelete(client, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'DELETE',
      targetEntity: before.name,
      payloadBefore: before,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.status(204).send();
  } catch (err) {
    console.error('Delete application error:', err);
    res.status(500).json({ error: 'Failed to delete application' });
  } finally {
    client.release();
  }
});

module.exports = router;
