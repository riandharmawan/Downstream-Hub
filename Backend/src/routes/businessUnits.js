/**
 * Business units CRUD. Admin only. Used for user and app mapping (NULL = Global).
 * Delete is soft (deleted_at). Data access via businessUnitsDb (excludes soft-deleted).
 */
const express = require('express');
const { pool } = require('../db/pool');
const businessUnitsDb = require('../db/businessUnitsDb');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');

const router = express.Router();

// GET /api/business-units — list all (Admin only)
router.get('/', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = await businessUnitsDb.list(pool);
    res.json({ business_units: rows });
  } catch (err) {
    console.error('List business units error:', err);
    res.status(500).json({ error: 'Failed to list departments' });
  }
});

// POST /api/business-units — create (Admin only)
router.post('/', authMiddleware, requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const client = await pool.connect();
  try {
    const row = await businessUnitsDb.create(client, name);
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'CREATE',
      targetEntity: `business_unit:${row.name}`,
      payloadBefore: null,
      payloadAfter: row,
      ipAddress: getClientIp(req),
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    console.error('Create business unit error:', err);
    res.status(500).json({ error: 'Failed to create department' });
  } finally {
    client.release();
  }
});

// PUT /api/business-units/:id — update (Admin only)
router.put('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const before = await businessUnitsDb.getById(client, id);
    if (!before) {
      return res.status(404).json({ error: 'Department not found' });
    }
    const row = await businessUnitsDb.update(client, id, name);
    if (!row) {
      return res.status(404).json({ error: 'Department not found' });
    }
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'UPDATE',
      targetEntity: `business_unit:${row.name}`,
      payloadBefore: before,
      payloadAfter: row,
      ipAddress: getClientIp(req),
    });
    res.json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    console.error('Update business unit error:', err);
    res.status(500).json({ error: 'Failed to update department' });
  } finally {
    client.release();
  }
});

// DELETE /api/business-units/:id — remove (Admin only, soft delete). Clear user/app FKs then soft-delete.
router.delete('/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const before = await businessUnitsDb.getById(client, id);
    if (!before) {
      return res.status(404).json({ error: 'Department not found' });
    }
    await businessUnitsDb.clearUserAndAppReferences(client, id);
    const ok = await businessUnitsDb.softDelete(client, id);
    if (!ok) {
      return res.status(404).json({ error: 'Department not found' });
    }
    await auditLog(client, {
      actorId: req.user.id,
      actionType: 'DELETE',
      targetEntity: `business_unit:${before.name}`,
      payloadBefore: before,
      payloadAfter: null,
      ipAddress: getClientIp(req),
    });
    res.status(204).send();
  } catch (err) {
    console.error('Delete business unit error:', err);
    res.status(500).json({ error: 'Failed to delete department' });
  } finally {
    client.release();
  }
});

module.exports = router;
