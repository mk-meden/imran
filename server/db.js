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

  // --- Migration: dedupe RSVPs by phone number ---------------------------
  // phone_key = the phone with all non-digits stripped (so "98765 43210" and
  // "9876543210" collide). A UNIQUE index on it lets the API upsert by phone.
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS phone_key  TEXT;`);
  await pool.query(`ALTER TABLE rsvp ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);

  // Backfill phone_key for any existing rows (blank -> NULL: the unique index
  // ignores NULLs, so rows without a phone never collide).
  await pool.query(`
    UPDATE rsvp
       SET phone_key = NULLIF(right(regexp_replace(COALESCE(phone,''), '\\D', '', 'g'), 10), '')
     WHERE phone_key IS NULL;
  `);

  // If duplicates already exist, keep the newest per phone_key so the unique
  // index below can be created (idempotent no-op when there are none).
  await pool.query(`
    DELETE FROM rsvp a USING rsvp b
     WHERE a.phone_key IS NOT NULL
       AND a.phone_key = b.phone_key
       AND a.id < b.id;
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_rsvp_phone_key ON rsvp (phone_key);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsvp_created ON rsvp (created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsvp_attending ON rsvp (attending);`);
}

module.exports = { pool, init };
