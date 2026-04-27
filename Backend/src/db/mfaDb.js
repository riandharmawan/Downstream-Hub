const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function upsertTrustedDevice(db, { userId, deviceHash, ipAddress, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO trusted_devices (user_id, device_hash, first_ip, last_ip, expires_at)
     VALUES ($1, $2, $3, $3, $4)
     ON CONFLICT (user_id, device_hash) WHERE revoked_at IS NULL
     DO UPDATE SET last_ip = EXCLUDED.last_ip, last_seen_at = now(), expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [userId, deviceHash, ipAddress || null, expiresAt]
  );
  return rows[0] || null;
}

async function getTrustedDevice(db, { userId, deviceHash }) {
  const { rows } = await db.query(
    `SELECT * FROM trusted_devices
     WHERE user_id = $1
       AND device_hash = $2
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [userId, deviceHash]
  );
  return rows[0] || null;
}

async function insertRiskEvent(db, payload) {
  const { userId, email, ipAddress, userAgent, deviceHash, riskScore, reasons, decision } = payload;
  await db.query(
    `INSERT INTO login_risk_events (user_id, email, ip_address, user_agent, device_hash, risk_score, reasons, decision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId || null, email || null, ipAddress || null, userAgent || null, deviceHash || null, riskScore, reasons || [], decision]
  );
}

async function createChallenge(db, { userId, reason, challengeId, otpHash, expiresAt, maxAttempts }) {
  await db.query(
    `INSERT INTO mfa_challenges (user_id, reason, challenge_hash, otp_hash, expires_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, reason, sha256(challengeId), otpHash, expiresAt, maxAttempts]
  );
}

async function getActiveChallenge(db, challengeId) {
  const { rows } = await db.query(
    `SELECT * FROM mfa_challenges
     WHERE challenge_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()`,
    [sha256(challengeId)]
  );
  return rows[0] || null;
}

async function markChallengeAttempt(db, id) {
  const { rows } = await db.query(
    'UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts',
    [id]
  );
  return rows[0] || null;
}

async function consumeChallenge(db, id) {
  await db.query('UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1', [id]);
}

async function updateLastMfaVerifiedAt(db, userId) {
  await db.query('UPDATE users SET last_mfa_verified_at = now() WHERE id = $1', [userId]);
}

module.exports = {
  getTrustedDevice,
  upsertTrustedDevice,
  insertRiskEvent,
  createChallenge,
  getActiveChallenge,
  markChallengeAttempt,
  consumeChallenge,
  updateLastMfaVerifiedAt,
};
