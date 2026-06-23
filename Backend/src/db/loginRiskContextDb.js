/**
 * Stores per-user login IP context used by Case 5 V1 risk checks.
 */
async function upsertSeenIp(db, { userId, ipAddress, userAgent }) {
  await db.query(
    `INSERT INTO user_login_contexts (user_id, ip_address, first_seen_at, last_seen_at, seen_count, last_user_agent, updated_at)
     VALUES ($1, $2, now(), now(), 1, $3, now())
     ON CONFLICT (user_id, ip_address)
     DO UPDATE SET
       last_seen_at = now(),
       seen_count = user_login_contexts.seen_count + 1,
       last_user_agent = EXCLUDED.last_user_agent,
       updated_at = now()`,
    [userId, ipAddress, userAgent || null]
  );
}

async function getByUserAndIp(db, userId, ipAddress) {
  const { rows } = await db.query(
    `SELECT id, user_id, ip_address, first_seen_at, last_seen_at, seen_count, last_user_agent
     FROM user_login_contexts
     WHERE user_id = $1 AND ip_address = $2`,
    [userId, ipAddress]
  );
  return rows[0] || null;
}

async function countDistinctIpsSince(db, userId, since) {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT ip_address)::INT AS cnt
     FROM user_login_contexts
     WHERE user_id = $1 AND last_seen_at >= $2`,
    [userId, since]
  );
  return rows[0]?.cnt || 0;
}

module.exports = {
  upsertSeenIp,
  getByUserAndIp,
  countDistinctIpsSince,
};
