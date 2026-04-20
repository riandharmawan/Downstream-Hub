/**
 * Downstream Hub — API server
 * Express REST API: auth, application metadata CRUD, SSO token generation.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadSecrets } = require('./config/loadSecrets');
const app = require('./app');
const { runMigrations } = require('./db/migrate');
const PORT = process.env.PORT || 4000;

function ensureUploadDirs() {
  const base = path.join(__dirname, '..', 'uploads', 'app-icons');
  fs.mkdirSync(base, { recursive: true });
}

async function start() {
  await loadSecrets();
  ensureUploadDirs();
  if (process.env.DATABASE_URL) {
    try {
      await runMigrations();
    } catch (err) {
      console.error('Migration failed:', err.message);
      process.exit(1);
    }
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Downstream Hub API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
