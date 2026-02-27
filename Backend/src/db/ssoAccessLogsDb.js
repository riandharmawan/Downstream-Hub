/**
 * SSO access logs data access. All reads exclude soft-deleted (deleted_at IS NULL).
 * No delete in API; column exists for standardization.
 */
async function insert(db, { user_id, application_id, outcome, ip_address }) {
  await db.query(
    `INSERT INTO sso_access_logs (user_id, application_id, outcome, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [user_id, application_id, outcome, ip_address ?? null]
  );
}

async function list(db, options = {}) {
  const { limit = 100 } = options;
  const { rows } = await db.query(
    `SELECT id, user_id, application_id, outcome, ip_address, created_at
     FROM sso_access_logs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  insert,
  list,
};
