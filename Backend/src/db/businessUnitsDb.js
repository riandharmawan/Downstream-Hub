/**
 * Business units data access. All reads exclude soft-deleted (deleted_at IS NULL).
 * Deletes are soft: UPDATE ... SET deleted_at = now().
 */
async function list(db) {
  const { rows } = await db.query(
    'SELECT id, name, created_at FROM business_units WHERE deleted_at IS NULL ORDER BY name'
  );
  return rows;
}

async function getById(db, id) {
  const { rows } = await db.query(
    'SELECT id, name, created_at FROM business_units WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

async function create(db, name) {
  const { rows } = await db.query(
    'INSERT INTO business_units (name) VALUES ($1) RETURNING id, name, created_at',
    [name]
  );
  return rows[0];
}

async function update(db, id, name) {
  const { rows } = await db.query(
    'UPDATE business_units SET name = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, name, created_at',
    [name, id]
  );
  return rows[0] || null;
}

async function softDelete(db, id) {
  const { rowCount } = await db.query(
    'UPDATE business_units SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

/** Clear user and app references to this BU (before or after soft-delete). */
async function clearUserAndAppReferences(db, buId) {
  await db.query('UPDATE users SET business_unit_id = NULL WHERE business_unit_id = $1', [buId]);
  // Clear legacy single-BU FK
  await db.query('UPDATE applications SET target_bu_id = NULL WHERE target_bu_id = $1', [buId]);
  // Clear junction table rows (ON DELETE CASCADE also handles this, but explicit for clarity)
  await db.query('DELETE FROM application_business_units WHERE business_unit_id = $1', [buId]);
}

module.exports = {
  list,
  getById,
  create,
  update,
  softDelete,
  clearUserAndAppReferences,
};
