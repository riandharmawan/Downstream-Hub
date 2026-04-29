/**
 * Per-application OIDC inbox verification (user x application).
 */

async function upsertVerified(db, { userId, applicationId, at = new Date() }) {
  await db.query(
    `INSERT INTO user_application_oidc_email_verified (user_id, application_id, verified_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, application_id) DO UPDATE SET verified_at = EXCLUDED.verified_at`,
    [userId, applicationId, at]
  );
}

async function isVerified(db, userId, applicationId) {
  if (!applicationId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM user_application_oidc_email_verified
     WHERE user_id = $1 AND application_id = $2
     LIMIT 1`,
    [userId, applicationId]
  );
  return rows.length > 0;
}

async function listByUser(db, userId) {
  const { rows } = await db.query(
    `SELECT application_id, verified_at
     FROM user_application_oidc_email_verified
     WHERE user_id = $1
     ORDER BY verified_at DESC`,
    [userId]
  );
  return rows;
}

/** Count OIDC apps verified vs total OIDC apps (for admin user list). */
async function countOidcVerifiedForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM user_application_oidc_email_verified v
        JOIN applications a ON a.id = v.application_id AND a.deleted_at IS NULL AND a.sso_mode = 'oidc'
        WHERE v.user_id = $1) AS verified_count,
       (SELECT COUNT(*)::int FROM applications a WHERE a.deleted_at IS NULL AND a.sso_mode = 'oidc') AS oidc_app_total`,
    [userId]
  );
  return rows[0] || { verified_count: 0, oidc_app_total: 0 };
}

module.exports = {
  upsertVerified,
  isVerified,
  listByUser,
  countOidcVerifiedForUser,
};
