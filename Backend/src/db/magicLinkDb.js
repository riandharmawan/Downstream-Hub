/**
 * One-time magic link login tokens (hash stored, never plaintext).
 */
async function insert(db, { userId, tokenHash, expiresAt, requestIp, pendingLoginHash }) {
  const { rows } = await db.query(
    `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, request_ip, pending_login_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, tokenHash, expiresAt, requestIp || null, pendingLoginHash || null]
  );
  return rows[0];
}

/** Find active token by SHA-256 hash of raw token. Returns null if missing, used, or expired. */
async function findActiveByHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, used_at, pending_login_hash, created_at
     FROM magic_link_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] || null;
}

/** Find token row by hash regardless of used/expired state (for failure diagnostics). */
async function findByHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, used_at, created_at
     FROM magic_link_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function hasNewerTokenForUser(db, userId, afterCreatedAt) {
  const { rows } = await db.query(
    `SELECT 1 FROM magic_link_tokens
     WHERE user_id = $1 AND created_at > $2
     LIMIT 1`,
    [userId, afterCreatedAt]
  );
  return rows.length > 0;
}

async function findActiveByPendingLoginHash(db, pendingLoginHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, pending_login_hash
     FROM magic_link_tokens
     WHERE pending_login_hash = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [pendingLoginHash]
  );
  return rows[0] || null;
}

async function markUsed(db, id) {
  await db.query(
    `UPDATE magic_link_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
    [id]
  );
}

/** Invalidate other pending tokens for user after successful sign-in. */
async function invalidatePendingForUser(db, userId) {
  await db.query(
    `UPDATE magic_link_tokens SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
}

module.exports = {
  insert,
  findActiveByHash,
  findByHash,
  hasNewerTokenForUser,
  findActiveByPendingLoginHash,
  markUsed,
  invalidatePendingForUser,
};
