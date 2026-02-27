/**
 * Seed one Admin user (run once after migrations).
 * Usage: node scripts/seed-admin.js
 * Creates admin@example.com / admin123 if no users exist.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db/pool');

async function seed() {
  const { rows } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (rows.length > 0) {
    console.log('Users already exist, skipping seed.');
    process.exit(0);
    return;
  }
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'Admin')`,
    ['admin@example.com', hash]
  );
  console.log('Created admin@example.com with password admin123');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
