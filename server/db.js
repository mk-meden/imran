'use strict';
/**
 * SQLite setup (better-sqlite3). One small file-based DB — perfect for a wedding
 * guest list. The DB file lives in DATA_DIR (a Docker volume in production so it
 * survives container rebuilds).
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'rsvp.db'));
db.pragma('journal_mode = WAL');   // better concurrency for reads while writing
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rsvp (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    phone      TEXT,
    guests     INTEGER NOT NULL DEFAULT 1,
    attending  TEXT    NOT NULL,
    message    TEXT,
    created_at TEXT    NOT NULL,   -- ISO 8601 UTC
    ip         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rsvp_created ON rsvp (created_at);
  CREATE INDEX IF NOT EXISTS idx_rsvp_attending ON rsvp (attending);
`);

module.exports = db;
