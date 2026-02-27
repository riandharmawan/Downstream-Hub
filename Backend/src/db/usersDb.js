/**
 * Users data access. All reads exclude soft-deleted (deleted_at IS NULL).
 * Deletes are soft: UPDATE ... SET deleted_at = now().
 */
async function listWithBu(db) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, u.business_unit_id, u.created_at,
            bu.name AS business_unit_name
     FROM users u
     LEFT JOIN business_units bu ON bu.id = u.business_unit_id AND bu.deleted_at IS NULL
     WHERE u.deleted_at IS NULL
     ORDER BY u.email`
  );
  return rows.map((r) => ({
    ...r,
    business_unit_name: r.business_unit_name || null,
  }));
}

async function getById(db, id) {
  const { rows } = await db.query(
    'SELECT id, email, role, business_unit_id FROM users WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

/** For /me: user with business_unit_name for display. */
async function getByIdWithBuName(db, id) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.role, u.business_unit_id, bu.name AS business_unit_name
     FROM users u
     LEFT JOIN business_units bu ON bu.id = u.business_unit_id AND bu.deleted_at IS NULL
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id]
  );
  const r = rows[0];
  return r ? { ...r, business_unit_name: r.business_unit_name || null } : null;
}

async function getByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id, email, password_hash, role, business_unit_id, password_changed_at FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email]
  );
  return rows[0] || null;
}

async function countActive(db) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL'
  );
  return rows[0].n;
}

async function create(db, { email, password_hash, role, business_unit_id }) {
  const buId = business_unit_id || null;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, business_unit_id, password_changed_at) VALUES ($1, $2, $3, $4, now())
     RETURNING id, email, role, business_unit_id, created_at`,
    [email, password_hash, role, buId]
  );
  return rows[0];
}

async function updatePassword(db, id, password_hash) {
  await db.query(
    'UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2 AND deleted_at IS NULL',
    [password_hash, id]
  );
}

async function updateBusinessUnit(db, id, business_unit_id) {
  await db.query(
    'UPDATE users SET business_unit_id = $1 WHERE id = $2 AND deleted_at IS NULL',
    [business_unit_id, id]
  );
  const { rows } = await db.query(
    'SELECT id, email, role, business_unit_id FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function softDelete(db, id) {
  const { rowCount } = await db.query(
    'UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  listWithBu,
  getById,
  getByIdWithBuName,
  getByEmail,
  countActive,
  create,
  updatePassword,
  updateBusinessUnit,
  softDelete,
};
