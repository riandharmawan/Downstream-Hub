/**
 * Password history per user (for "no reuse of last N passwords").
 */
async function getHashesForUser(db, userId, limit) {
  const { rows } = await db.query(
    `SELECT password_hash FROM user_password_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(0, parseInt(limit, 10) || 0)]
  );
  return rows;
}

async function add(db, userId, password_hash) {
  await db.query(
    'INSERT INTO user_password_history (user_id, password_hash) VALUES ($1, $2)',
    [userId, password_hash]
  );
}

async function trimToLimit(db, userId, limit) {
  const n = Math.max(0, parseInt(limit, 10) || 0);
  if (n === 0) return;
  const { rows } = await db.query(
    `SELECT id FROM user_password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, n]
  );
  const keepIds = rows.map((r) => r.id);
  if (keepIds.length === 0) return;
  await db.query(
    `DELETE FROM user_password_history WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))`,
    [userId, keepIds]
  );
}

async function deleteForUser(db, userId) {
  await db.query('DELETE FROM user_password_history WHERE user_id = $1', [userId]);
}

module.exports = {
  getHashesForUser,
  add,
  trimToLimit,
  deleteForUser,
};
