/**
 * App-scoped first-login verification and one-time tokens.
 */
async function getVerification(db, userId, applicationId) {
  const { rows } = await db.query(
    `SELECT id, user_id, application_id, last_verified_at, verified_via
     FROM user_application_verifications
     WHERE user_id = $1 AND application_id = $2`,
    [userId, applicationId]
  );
  return rows[0] || null;
}

async function upsertVerification(db, { userId, applicationId, verifiedVia = 'magic_link' }) {
  await db.query(
    `INSERT INTO user_application_verifications (user_id, application_id, last_verified_at, verified_via, updated_at)
     VALUES ($1, $2, now(), $3, now())
     ON CONFLICT (user_id, application_id)
     DO UPDATE SET last_verified_at = now(), verified_via = EXCLUDED.verified_via, updated_at = now()`,
    [userId, applicationId, verifiedVia]
  );
}

async function insertToken(db, { userId, applicationId, tokenHash, expiresAt, requestIp }) {
  const { rows } = await db.query(
    `INSERT INTO app_login_magic_tokens (user_id, application_id, token_hash, expires_at, request_ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, applicationId, tokenHash, expiresAt, requestIp || null]
  );
  return rows[0];
}

async function findActiveTokenByHash(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id, application_id, expires_at, used_at
     FROM app_login_magic_tokens
     WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markTokenUsed(db, tokenId) {
  await db.query(
    `UPDATE app_login_magic_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
    [tokenId]
  );
}

async function invalidatePendingForUserApp(db, userId, applicationId) {
  await db.query(
    `UPDATE app_login_magic_tokens
     SET used_at = now()
     WHERE user_id = $1 AND application_id = $2 AND used_at IS NULL`,
    [userId, applicationId]
  );
}

module.exports = {
  getVerification,
  upsertVerification,
  insertToken,
  findActiveTokenByHash,
  markTokenUsed,
  invalidatePendingForUserApp,
};
