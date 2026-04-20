#!/usr/bin/env node
/**
 * Standalone database migration runner.
 * Usage: from Backend/ run: node scripts/run-migrate.js
 * Requires: DATABASE_URL in env (e.g. from .env or export).
 */
const path = require('path');
// Load .env: project root first, then Backend/ (so Backend/.env overrides on server)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { runMigrations } = require('../src/db/migrate');

runMigrations()
  .then(() => {
    console.log('Migrations completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
