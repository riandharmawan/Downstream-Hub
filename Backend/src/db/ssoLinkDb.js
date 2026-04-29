const crypto = require('crypto');

function subjectFingerprint(subject) {
  const hash = crypto.createHash('sha256').update(String(subject || ''), 'utf8').digest('hex');
  return `...${hash.slice(-6)}`;
}

async function getUserSsoStatus(db, userId) {
  const { rows } = await db.query(
    `SELECT id, email, auth_source, oidc_sub, oidc_linked_at, oidc_linked_by_mode
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    user_id: row.id,
    email: row.email,
    auth_source: row.auth_source || 'local',
    linked: !!row.oidc_sub,
    linked_at: row.oidc_linked_at || null,
    linked_by_mode: row.oidc_linked_by_mode || null,
    subject_fingerprint: row.oidc_sub ? subjectFingerprint(row.oidc_sub) : null,
  };
}

async function getByOidcSub(db, oidcSub) {
  const { rows } = await db.query(
    `SELECT id, email, oidc_sub
     FROM users
     WHERE oidc_sub = $1 AND deleted_at IS NULL`,
    [oidcSub]
  );
  return rows[0] || null;
}

async function linkOidcSubToUser(db, { userId, oidcSub, mode }) {
  const { rows } = await db.query(
    `UPDATE users
     SET oidc_sub = $2,
         oidc_linked_at = now(),
         oidc_linked_by_mode = $3
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, email, oidc_sub, oidc_linked_at, oidc_linked_by_mode`,
    [userId, oidcSub, mode]
  );
  return rows[0] || null;
}

async function unlinkOidcSubFromUser(db, { userId }) {
  const { rows } = await db.query(
    `UPDATE users
     SET oidc_sub = NULL,
         oidc_linked_at = NULL,
         oidc_linked_by_mode = NULL
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, email`,
    [userId]
  );
  return rows[0] || null;
}

async function insertLinkEvent(db, payload) {
  const {
    userId = null,
    actorId = null,
    mode,
    eventType,
    status,
    reasonCode = null,
    subjectFingerprint: fp = null,
    metadata = {},
  } = payload;
  await db.query(
    `INSERT INTO sso_link_events
      (user_id, actor_id, mode, event_type, status, reason_code, subject_fingerprint, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [userId, actorId, mode, eventType, status, reasonCode, fp, JSON.stringify(metadata || {})]
  );
}

async function listLinkEventsByUser(db, userId, limit = 25) {
  const { rows } = await db.query(
    `SELECT id, user_id, actor_id, mode, event_type, status, reason_code, subject_fingerprint, metadata, created_at
     FROM sso_link_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function createEmailVerification(db, { userId, actorId = null, mode, oidcSub, email, tokenHash, expiresAt, applicationId = null }) {
  const { rows } = await db.query(
    `INSERT INTO sso_link_email_verifications
      (user_id, actor_id, mode, oidc_sub, email, token_hash, expires_at, application_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, mode, oidc_sub, email, expires_at, application_id`,
    [userId, actorId, mode, oidcSub, email, tokenHash, expiresAt, applicationId || null]
  );
  return rows[0] || null;
}

async function consumeEmailVerification(db, tokenHash) {
  const { rows } = await db.query(
    `UPDATE sso_link_email_verifications
     SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING id, user_id, actor_id, mode, oidc_sub, email, application_id`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function createBulkJob(db, { createdBy, sourceType, totalRows }) {
  const { rows } = await db.query(
    `INSERT INTO sso_link_jobs (created_by, source_type, total_rows)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [createdBy, sourceType, totalRows]
  );
  return rows[0] || null;
}

async function updateBulkJobCounters(db, { jobId, status, readyRows, linkedRows, blockedRows, failedRows, started, finished }) {
  const { rows } = await db.query(
    `UPDATE sso_link_jobs
     SET status = COALESCE($2, status),
         ready_rows = COALESCE($3, ready_rows),
         linked_rows = COALESCE($4, linked_rows),
         blocked_rows = COALESCE($5, blocked_rows),
         failed_rows = COALESCE($6, failed_rows),
         started_at = CASE WHEN $7::boolean THEN COALESCE(started_at, now()) ELSE started_at END,
         finished_at = CASE WHEN $8::boolean THEN now() ELSE finished_at END
     WHERE id = $1
     RETURNING *`,
    [jobId, status || null, readyRows ?? null, linkedRows ?? null, blockedRows ?? null, failedRows ?? null, !!started, !!finished]
  );
  return rows[0] || null;
}

async function insertBulkItems(db, jobId, items) {
  for (const item of items) {
    await db.query(
      `INSERT INTO sso_link_job_items
        (job_id, user_id, email, oidc_sub, match_status, final_status, reason_code, reason_detail, attempt_count, last_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        jobId,
        item.user_id || null,
        item.email || null,
        item.oidc_sub || null,
        item.match_status,
        item.final_status || null,
        item.reason_code || null,
        item.reason_detail || null,
        item.attempt_count || 0,
        item.last_attempt_at || null,
      ]
    );
  }
}

async function getBulkJob(db, jobId) {
  const { rows } = await db.query('SELECT * FROM sso_link_jobs WHERE id = $1', [jobId]);
  return rows[0] || null;
}

async function listBulkItems(db, jobId) {
  const { rows } = await db.query(
    `SELECT id, user_id, email, oidc_sub, match_status, final_status, reason_code, reason_detail, attempt_count, last_attempt_at, created_at
     FROM sso_link_job_items
     WHERE job_id = $1
     ORDER BY created_at ASC`,
    [jobId]
  );
  return rows;
}

module.exports = {
  subjectFingerprint,
  getUserSsoStatus,
  getByOidcSub,
  linkOidcSubToUser,
  unlinkOidcSubFromUser,
  insertLinkEvent,
  listLinkEventsByUser,
  createEmailVerification,
  consumeEmailVerification,
  createBulkJob,
  updateBulkJobCounters,
  insertBulkItems,
  getBulkJob,
  listBulkItems,
};
