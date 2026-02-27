/**
 * Make a user's password "expired" for testing the change-password-expired flow.
 * 1. Sets password policy to 1 day (so passwords expire after 1 day).
 * 2. Sets the given user's password_changed_at to 2 days ago.
 * Then when that user tries to log in, they get PASSWORD_EXPIRED and are sent to the change-password-expired page.
 *
 * Usage: node scripts/expire-user-password.js <email>
 * Example: node scripts/expire-user-password.js user@example.com
 *
 * Run from backend/ or project root (with DATABASE_URL set).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require(path.join(__dirname, '..', 'src', 'db', 'pool'));

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/expire-user-password.js <email>');
  console.error('Example: node scripts/expire-user-password.js user@example.com');
  process.exit(1);
}

const emailNorm = email.trim().toLowerCase();

async function run() {
  const client = await pool.connect();
  try {
    // 1. Ensure password policy exists and set to 1 day (so anything older than 1 day is expired)
    await client.query(
      `INSERT INTO password_policy (id, password_expiry_days) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET password_expiry_days = 1, updated_at = now()`
    );
    console.log('Password policy set to 1 day (passwords expire after 1 day).');

    // 2. Set this user's password_changed_at to 2 days ago
    const { rowCount } = await client.query(
      `UPDATE users
       SET password_changed_at = now() - interval '2 days'
       WHERE email = $1 AND deleted_at IS NULL`,
      [emailNorm]
    );

    if (rowCount === 0) {
      console.error(`No active user found with email: ${emailNorm}`);
      process.exit(1);
    }

    console.log(`User "${emailNorm}" now has an expired password (password_changed_at set to 2 days ago).`);
    console.log('');
    console.log('To test:');
    console.log('  1. Go to the Login page.');
    console.log(`  2. Sign in with ${emailNorm} and their current password.`);
    console.log('  3. You should be redirected to "Password expired" and asked to set a new password.');
  } finally {
    client.release();
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
