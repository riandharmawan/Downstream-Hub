const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function create(db, { userId, sessionToken, csrfToken, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO auth_sessions (user_id, session_token_hash, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at`,
    [userId, sha256(sessionToken), sha256(csrfToken), expiresAt]
  );
  return rows[0] || null;
}

async function getActiveBySessionToken(db, sessionToken) {
  const { rows } = await db.query(
    `SELECT id, user_id, csrf_token_hash, expires_at, revoked_at
     FROM auth_sessions
     WHERE session_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(sessionToken)]
  );
  return rows[0] || null;
}

async function revokeBySessionToken(db, sessionToken) {
  await db.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE session_token_hash = $1 AND revoked_at IS NULL',
    [sha256(sessionToken)]
  );
}

function csrfMatches(storedHash, csrfToken) {
  if (!storedHash || !csrfToken) return false;
  return storedHash === sha256(csrfToken);
}

module.exports = { create, getActiveBySessionToken, revokeBySessionToken, csrfMatches };
