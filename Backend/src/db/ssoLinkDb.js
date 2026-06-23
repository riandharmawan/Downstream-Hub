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

async function createEmailVerification(db, { userId, actorId = null, mode, oidcSub, email, tokenHash, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO sso_link_email_verifications
      (user_id, actor_id, mode, oidc_sub, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, user_id, mode, oidc_sub, email, expires_at`,
    [userId, actorId, mode, oidcSub, email, tokenHash, expiresAt]
  );
  return rows[0] || null;
}

async function consumeEmailVerification(db, tokenHash) {
  const { rows } = await db.query(
    `UPDATE sso_link_email_verifications
     SET consumed_at = now()
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING id, user_id, actor_id, mode, oidc_sub, email`,
    [tokenHash]
  );
  return rows[0] || null;
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
};
