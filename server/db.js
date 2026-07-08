'use strict';
/**
 * Postgres setup (node-postgres). Works with any hosted Postgres — the default
 * target is a free Neon database. The connection string comes from DATABASE_URL.
 *
 * Neon/most hosted Postgres require TLS; the connection string usually ends with
 * `?sslmode=require`. We also enable ssl here for safety on non-local hosts.
 */
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  console.warn('[warn] DATABASE_URL is not set — the server cannot store RSVPs until it is.');
}

const isLocal = /localhost|127\.0\.0\.1|::1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
});

// Create the table + indexes if they don't exist yet (safe to run every boot).
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvp (
      id         SERIAL PRIMARY KEY,
      name       TEXT        NOT NULL,
      phone      TEXT,
      guests     INTEGER     NOT NULL DEFAULT 1,
      attending  TEXT        NOT NULL,
      message    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ip         TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsvp_created ON rsvp (created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsvp_attending ON rsvp (attending);`);
}

module.exports = { pool, init };
