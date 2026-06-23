/**
 * One-time magic link login tokens (hash stored, never plaintext).
 */
async function insert(db, { userId, tokenHash, expiresAt, requestIp }) {
  const { rows } = await db.query(
    `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, request_ip)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [userId, tokenHash, expiresAt, requestIp || null]
  );
  return rows[0];
}

/** Find active token by SHA-256 hash of raw token. */
async function findActiveByHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, used_at
     FROM magic_link_tokens
     WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash]
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
  markUsed,
  invalidatePendingForUser,
};
