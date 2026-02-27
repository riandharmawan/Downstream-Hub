/**
 * Allowed domains data access. All reads exclude soft-deleted (deleted_at IS NULL).
 * Deletes are soft: UPDATE ... SET deleted_at = now().
 */
async function list(db) {
  const { rows } = await db.query(
    'SELECT id, domain, created_at FROM allowed_domains WHERE deleted_at IS NULL ORDER BY domain'
  );
  return rows;
}

async function getById(db, id) {
  const { rows } = await db.query(
    'SELECT id, domain, created_at FROM allowed_domains WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

async function getByDomain(db, domain) {
  const { rows } = await db.query(
    'SELECT id, domain, created_at FROM allowed_domains WHERE domain = $1 AND deleted_at IS NULL',
    [domain]
  );
  return rows[0] || null;
}

async function countActive(db) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM allowed_domains WHERE deleted_at IS NULL'
  );
  return rows[0].n;
}

async function create(db, domain) {
  const { rows } = await db.query(
    'INSERT INTO allowed_domains (domain) VALUES ($1) RETURNING id, domain, created_at',
    [domain]
  );
  return rows[0];
}

async function update(db, id, domain) {
  const { rows } = await db.query(
    'UPDATE allowed_domains SET domain = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, domain, created_at',
    [domain, id]
  );
  return rows[0] || null;
}

async function softDelete(db, id) {
  const { rowCount } = await db.query(
    'UPDATE allowed_domains SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  list,
  getById,
  getByDomain,
  countActive,
  create,
  update,
  softDelete,
};
