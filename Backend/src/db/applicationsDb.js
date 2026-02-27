/**
 * Applications data access. All reads exclude soft-deleted (deleted_at IS NULL).
 * Deletes are soft: UPDATE ... SET deleted_at = now().
 */
const NOT_DELETED = ' AND a.deleted_at IS NULL';

async function listActive(db, businessUnitId) {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.description, a.icon_url, a.target_url, a.target_bu_id, a.created_at, a.updated_at
     FROM applications a
     WHERE (a.target_bu_id IS NULL OR a.target_bu_id = $1)${NOT_DELETED}
     ORDER BY a.name`,
    [businessUnitId]
  );
  return rows;
}

async function listAllWithBuName(db) {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.description, a.icon_url, a.target_url, a.target_bu_id, a.created_at, a.updated_at,
            bu.name AS target_bu_name
     FROM applications a
     LEFT JOIN business_units bu ON bu.id = a.target_bu_id AND bu.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     ORDER BY a.name`
  );
  return rows.map((r) => ({ ...r, target_bu_name: r.target_bu_name || null }));
}

async function getById(db, id) {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.description, a.icon_url, a.target_url, a.target_bu_id, a.created_at, a.updated_at,
            bu.name AS target_bu_name
     FROM applications a
     LEFT JOIN business_units bu ON bu.id = a.target_bu_id AND bu.deleted_at IS NULL
     WHERE a.id = $1${NOT_DELETED}`,
    [id]
  );
  return rows[0] ? { ...rows[0], target_bu_name: rows[0].target_bu_name || null } : null;
}

async function getByIdForUpdate(db, id) {
  const { rows } = await db.query(
    'SELECT id, name, description, icon_url, target_url, target_bu_id FROM applications WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

async function create(db, { name, description, icon_url, target_url, target_bu_id }) {
  const { rows } = await db.query(
    `INSERT INTO applications (name, description, icon_url, target_url, target_bu_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, description, icon_url, target_url, target_bu_id, created_at, updated_at`,
    [name, description, icon_url || '', target_url, target_bu_id]
  );
  return rows[0];
}

async function update(db, id, { name, description, icon_url, target_url, target_bu_id }) {
  await db.query(
    `UPDATE applications SET name = $1, description = $2, icon_url = $3, target_url = $4, target_bu_id = $5, updated_at = now()
     WHERE id = $6 AND deleted_at IS NULL`,
    [name, description, icon_url || '', target_url, target_bu_id, id]
  );
  const { rows } = await db.query(
    'SELECT id, name, description, icon_url, target_url, target_bu_id, created_at, updated_at FROM applications WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function softDelete(db, id) {
  const { rowCount } = await db.query(
    'UPDATE applications SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  listActive,
  listAllWithBuName,
  getById,
  getByIdForUpdate,
  create,
  update,
  softDelete,
};
