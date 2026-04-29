/**
 * User list, manual create, BU assignment, deactivate, reset password. Admin only.
 * Data access via usersDb (excludes soft-deleted users).
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const usersDb = require('../db/usersDb');
const ssoLinkDb = require('../db/ssoLinkDb');
const businessUnitsDb = require('../db/businessUnitsDb');
const allowedDomainsDb = require('../db/allowedDomainsDb');
const passwordPolicyDb = require('../db/passwordPolicyDb');
const passwordHistoryDb = require('../db/passwordHistoryDb');
const ssoLinkService = require('../services/ssoLinkService');
const applicationsDb = require('../db/applicationsDb');
const userApplicationSsoDb = require('../db/userApplicationSsoDb');
const { validatePassword } = require('../lib/passwordValidation');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { auditLog, getClientIp } = require('../middleware/audit');
const mailer = require('../lib/mailer');

const router = express.Router();

function publicAppBase() {
  return (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function dashboardVerifyUrl(applicationId, tokenRaw) {
  const base = publicAppBase();
  return `${base}/?application_id=${encodeURIComponent(applicationId)}&sso_verify=${encodeURIComponent(tokenRaw)}`;
}

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
    const { rows: countRows } = await pool.query(
      `SELECT user_id, COUNT(*)::int AS n
       FROM user_application_oidc_email_verified
       GROUP BY user_id`
    );
    const verifiedByUser = new Map(countRows.map((c) => [c.user_id, c.n]));
    const { rows: totRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM applications WHERE deleted_at IS NULL AND sso_mode = 'oidc'`
    );
    const oidcAppTotal = totRows[0]?.n ?? 0;
    const users = rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      business_unit_id: r.business_unit_id,
      business_unit_name: r.business_unit_name || null,
      created_at: r.created_at,
      locked_until: r.locked_until || null,
      oidc_linked: !!r.oidc_sub,
      oidc_linked_at: r.oidc_linked_at || null,
      oidc_linked_by_mode: r.oidc_linked_by_mode || null,
      oidc_subject_fingerprint: r.oidc_sub ? ssoLinkDb.subjectFingerprint(r.oidc_sub) : null,
      oidc_apps_verified_count: verifiedByUser.get(r.id) || 0,
      oidc_apps_oidc_total: oidcAppTotal,
    }));
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/users/me/application-sso-status — apps visible to user + per-app OIDC verification
router.get('/me/application-sso-status', authMiddleware, async (req, res) => {
  try {
    const me = await usersDb.getById(pool, req.user.id);
    if (!me) return res.status(404).json({ error: 'User not found' });
    const buId = me.business_unit_id ?? null;
    const applications = await applicationsDb.listActive(pool, buId);
    const verifiedRows = await userApplicationSsoDb.listByUser(pool, req.user.id);
    const verifiedSet = new Set(verifiedRows.map((x) => String(x.application_id)));
    const apps = applications.map((a) => ({
      id: a.id,
      name: a.name,
      icon_url: a.icon_url,
      target_url: a.target_url,
      sso_mode: a.sso_mode,
      verified_for_oidc: a.sso_mode === 'oidc' && verifiedSet.has(String(a.id)),
    }));
    return res.json({ applications: apps });
  } catch (err) {
    console.error('Application SSO status error:', err);
    return res.status(500).json({ error: 'Failed to load application SSO status' });
  }
});

// GET /api/users/me/sso-status — self-service SSO link status
router.get('/me/sso-status', authMiddleware, async (req, res) => {
  try {
    const status = await ssoLinkService.getUserStatus(pool, req.user.id);
    if (!status) return res.status(404).json({ error: 'User not found' });
    return res.json({
      linked: status.linked,
      authSource: status.auth_source,
      linkedAt: status.linked_at,
      linkedByMode: status.linked_by_mode,
      subjectFingerprint: status.subject_fingerprint,
    });
  } catch (err) {
    console.error('Get SSO status error:', err);
    return res.status(500).json({ error: 'Failed to load SSO status' });
  }
});

// POST /api/users/me/sso-connect/start — sends verification link for one OIDC application
router.post('/me/sso-connect/start', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const applicationId = String(req.body?.application_id || '').trim();
    if (!applicationId) return res.status(400).json({ error: 'application_id required' });
    const me = await usersDb.getById(client, req.user.id);
    if (!me) return res.status(404).json({ error: 'User not found' });
    const app = await applicationsDb.getAccessibleById(client, applicationId, me.business_unit_id);
    if (!app) return res.status(404).json({ error: 'Application not found or not available for your account' });
    if (app.sso_mode !== 'oidc') {
      return res.status(400).json({ error: 'Per-app verification applies to OIDC applications only' });
    }
    const subject = ssoLinkService.buildSyntheticSubjectForUser(me);
    const result = await ssoLinkService.createEmailVerification(client, {
      user: me,
      mode: 'connect_sso',
      subject,
      actorId: req.user.id,
      applicationId,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.code || 'verification_create_failed' });
    }
    const verifyUrl = dashboardVerifyUrl(applicationId, result.tokenRaw);
    try {
      await mailer.sendSsoLinkVerificationEmail({ to: me.email, verifyUrl });
    } catch (mailErr) {
      console.error('SSO connect email send failed:', mailErr.message);
    }
    return res.json({
      message: 'Verification email sent',
      expires_at: result.expiresAt,
    });
  } catch (err) {
    console.error('Start SSO connect error:', err);
    return res.status(500).json({ error: 'Failed to start SSO connect' });
  } finally {
    client.release();
  }
});

// POST /api/users/me/sso-unlink — self unlink
router.post('/me/sso-unlink', authMiddleware, async (req, res) => {
  try {
    const row = await ssoLinkDb.unlinkOidcSubFromUser(pool, { userId: req.user.id });
    if (!row) return res.status(404).json({ error: 'User not found' });
    await ssoLinkDb.insertLinkEvent(pool, {
      userId: req.user.id,
      actorId: req.user.id,
      mode: 'self_service',
      eventType: 'unlink',
      status: 'success',
    });
    return res.json({ message: 'SSO unlinked' });
  } catch (err) {
    console.error('Unlink SSO error:', err);
    return res.status(500).json({ error: 'Failed to unlink SSO' });
  }
});

// GET /api/users/sso/verify?token=...&application_id=... — consumes verification token and links account
router.get('/sso/verify', authMiddleware, async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token required' });
    const applicationId = String(req.query.application_id || '').trim() || null;
    const result = await ssoLinkService.consumeEmailVerificationAndLink(pool, {
      actorId: req.user.id,
      tokenRaw: token,
      applicationIdFromClient: applicationId,
    });
    if (!result.ok) return res.status(400).json({ error: result.code });
    return res.json({ message: 'SSO linked successfully' });
  } catch (err) {
    console.error('Verify SSO link error:', err);
    return res.status(500).json({ error: 'Failed to verify link' });
  }
});

// GET /api/users/:id/sso-status — admin status lookup
router.get('/:id/sso-status', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const status = await ssoLinkService.getUserStatus(pool, req.params.id);
    if (!status) return res.status(404).json({ error: 'User not found' });
    return res.json({
      linked: status.linked,
      authSource: status.auth_source,
      linkedAt: status.linked_at,
      linkedByMode: status.linked_by_mode,
      subjectFingerprint: status.subject_fingerprint,
    });
  } catch (err) {
    console.error('Admin get SSO status error:', err);
    return res.status(500).json({ error: 'Failed to load SSO status' });
  }
});

// GET /api/users/:id/sso-events — admin history
router.get('/:id/sso-events', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const events = await ssoLinkDb.listLinkEventsByUser(pool, req.params.id, 50);
    return res.json({ events });
  } catch (err) {
    console.error('Admin get SSO events error:', err);
    return res.status(500).json({ error: 'Failed to load SSO events' });
  }
});

// POST /api/users/:id/sso-link/start — admin prelink URL (requires target OIDC application)
router.post('/:id/sso-link/start', authMiddleware, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const applicationId = String(req.body?.application_id || '').trim();
    if (!applicationId) return res.status(400).json({ error: 'application_id required' });
    const target = await usersDb.getById(client, req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const app = await applicationsDb.getById(client, applicationId);
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (app.sso_mode !== 'oidc') {
      return res.status(400).json({ error: 'Prelink applies to OIDC applications only' });
    }
    const subject = ssoLinkService.buildSyntheticSubjectForUser(target);
    const result = await ssoLinkService.createEmailVerification(client, {
      user: target,
      mode: 'admin_prelink',
      subject,
      actorId: req.user.id,
      applicationId,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.code || 'verification_create_failed' });
    }
    const url = dashboardVerifyUrl(applicationId, result.tokenRaw);
    await ssoLinkDb.insertLinkEvent(client, {
      userId: target.id,
      actorId: req.user.id,
      mode: 'admin_prelink',
      eventType: 'prelink_generated',
      status: 'success',
      metadata: { application_id: applicationId },
    });
    return res.json({ url, expires_at: result.expiresAt });
  } catch (err) {
    console.error('Admin prelink start error:', err);
    return res.status(500).json({ error: 'Failed to generate prelink URL' });
  } finally {
    client.release();
  }
});

// POST /api/users/:id/sso-unlink — admin unlink
router.post('/:id/sso-unlink', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const row = await ssoLinkDb.unlinkOidcSubFromUser(pool, { userId: req.params.id });
    if (!row) return res.status(404).json({ error: 'User not found' });
    await ssoLinkDb.insertLinkEvent(pool, {
      userId: req.params.id,
      actorId: req.user.id,
      mode: 'admin',
      eventType: 'unlink',
      status: 'success',
      reasonCode: req.body?.reason ? 'admin_reason_provided' : null,
      metadata: { reason: String(req.body?.reason || '').trim() || null },
    });
    return res.json({ message: 'SSO unlinked' });
  } catch (err) {
    console.error('Admin unlink SSO error:', err);
    return res.status(500).json({ error: 'Failed to unlink SSO' });
  }
});

// POST /api/users/sso-link/bulk/dry-run
router.post('/sso-link/bulk/dry-run', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const output = [];
    for (const row of rows) {
      const email = String(row?.email || '').trim().toLowerCase();
      const oidcSub = String(row?.oidc_sub || '').trim();
      if (!email || !oidcSub) {
        output.push({ email, oidc_sub: oidcSub, final_status: 'blocked_email_mismatch', reason_code: 'missing_required_fields' });
        continue;
      }
      const user = await usersDb.getByEmail(pool, email);
      if (!user) {
        output.push({ email, oidc_sub: oidcSub, final_status: 'blocked_email_mismatch', reason_code: 'user_not_found' });
        continue;
      }
      const existing = await ssoLinkDb.getByOidcSub(pool, oidcSub);
      if (existing && existing.id !== user.id) {
        output.push({ user_id: user.id, email, oidc_sub: oidcSub, final_status: 'blocked_collision', reason_code: 'oidc_sub_already_linked' });
        continue;
      }
      output.push({ user_id: user.id, email, oidc_sub: oidcSub, final_status: user.oidc_sub ? 'skipped_already_linked' : 'linked', reason_code: null });
    }
    return res.json({ rows: output });
  } catch (err) {
    console.error('Bulk dry-run error:', err);
    return res.status(500).json({ error: 'Bulk dry-run failed' });
  }
});

// POST /api/users/sso-link/bulk/jobs
router.post('/sso-link/bulk/jobs', authMiddleware, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const job = await ssoLinkDb.createBulkJob(client, {
      createdBy: req.user.id,
      sourceType: 'csv',
      totalRows: rows.length,
    });
    const items = [];
    let linkedRows = 0;
    let blockedRows = 0;
    let failedRows = 0;
    for (const row of rows) {
      const email = String(row?.email || '').trim().toLowerCase();
      const oidcSub = String(row?.oidc_sub || '').trim();
      if (!email || !oidcSub) {
        blockedRows += 1;
        items.push({ email, oidc_sub: oidcSub, match_status: 'blocked', final_status: 'blocked_email_mismatch', reason_code: 'missing_required_fields' });
        continue;
      }
      const user = await usersDb.getByEmail(client, email);
      if (!user) {
        blockedRows += 1;
        items.push({ email, oidc_sub: oidcSub, match_status: 'blocked', final_status: 'blocked_email_mismatch', reason_code: 'user_not_found' });
        continue;
      }
      const result = await ssoLinkService.linkUserSubject(client, { actorId: req.user.id, user, subject: oidcSub, mode: 'bulk' });
      if (!result.ok) {
        blockedRows += 1;
        items.push({ user_id: user.id, email, oidc_sub: oidcSub, match_status: 'blocked', final_status: 'blocked_collision', reason_code: result.code, attempt_count: 1, last_attempt_at: new Date() });
      } else {
        linkedRows += 1;
        items.push({ user_id: user.id, email, oidc_sub: oidcSub, match_status: 'ready', final_status: 'linked', reason_code: null, attempt_count: 1, last_attempt_at: new Date() });
      }
    }
    await ssoLinkDb.insertBulkItems(client, job.id, items);
    await ssoLinkDb.updateBulkJobCounters(client, {
      jobId: job.id,
      status: failedRows > 0 ? 'failed' : 'completed',
      readyRows: linkedRows,
      linkedRows,
      blockedRows,
      failedRows,
      started: true,
      finished: true,
    });
    return res.status(201).json({ job_id: job.id });
  } catch (err) {
    console.error('Bulk job create error:', err);
    return res.status(500).json({ error: 'Failed to execute bulk job' });
  } finally {
    client.release();
  }
});

// GET /api/users/sso-link/bulk/jobs/:jobId
router.get('/sso-link/bulk/jobs/:jobId', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const job = await ssoLinkDb.getBulkJob(pool, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json({ job });
  } catch (err) {
    console.error('Get bulk job error:', err);
    return res.status(500).json({ error: 'Failed to load job' });
  }
});

// GET /api/users/sso-link/bulk/jobs/:jobId/items
router.get('/sso-link/bulk/jobs/:jobId/items', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const rows = await ssoLinkDb.listBulkItems(pool, req.params.jobId);
    return res.json({ rows });
  } catch (err) {
    console.error('Get bulk job items error:', err);
    return res.status(500).json({ error: 'Failed to load job items' });
  }
});

// POST /api/users/sso-link/bulk/jobs/:jobId/retry
router.post('/sso-link/bulk/jobs/:jobId/retry', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const items = await ssoLinkDb.listBulkItems(pool, req.params.jobId);
    const retryable = items.filter((x) => x.final_status === 'failed_retryable');
    return res.json({ retried: retryable.length, message: 'Retry queue evaluated (manual retry flow pending for non-retryable statuses).' });
  } catch (err) {
    console.error('Retry bulk job error:', err);
    return res.status(500).json({ error: 'Failed to retry job' });
  }
});

// GET /api/users/sso-link/bulk/jobs/:jobId/export.csv
router.get('/sso-link/bulk/jobs/:jobId/export.csv', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const items = await ssoLinkDb.listBulkItems(pool, req.params.jobId);
    const lines = [
      'email,oidc_sub,final_status,reason_code,reason_detail',
      ...items.map((x) =>
        [
          JSON.stringify(x.email || ''),
          JSON.stringify(x.oidc_sub || ''),
          JSON.stringify(x.final_status || ''),
          JSON.stringify(x.reason_code || ''),
          JSON.stringify(x.reason_detail || ''),
        ].join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sso-link-job-${req.params.jobId}.csv"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export bulk job CSV error:', err);
    return res.status(500).json({ error: 'Failed to export CSV' });
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
