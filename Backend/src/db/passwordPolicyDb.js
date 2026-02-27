/**
 * Password policy (single row). password_expiry_days: 0 = disabled, >0 = must change after N days.
 */
async function get(db) {
  const { rows } = await db.query(
    'SELECT password_expiry_days FROM password_policy WHERE id = 1'
  );
  return rows[0] || { password_expiry_days: 0 };
}

async function update(db, { password_expiry_days }) {
  const days = Math.max(0, Math.min(365, parseInt(String(password_expiry_days), 10) || 0));
  await db.query(
    'UPDATE password_policy SET password_expiry_days = $1, updated_at = now() WHERE id = 1',
    [days]
  );
  return get(db);
}

module.exports = { get, update };
