'use strict';
/**
 * Wedding RSVP API + public dashboard.
 *
 *   POST /api/rsvp      store one RSVP  (rate-limited, CORS-guarded)
 *   GET  /api/rsvp      list all entries
 *   GET  /api/stats     live counts
 *   GET  /dashboard     the dashboard page (public — anyone with the link)
 *   GET  /health        health check
 *
 * Config via env (see .env.example):
 *   PORT, DATABASE_URL, ALLOWED_ORIGIN
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const { pool, init } = require('./db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);                 // behind Render's proxy: trust the single hop
app.use(express.json({ limit: '16kb' }));  // small payloads only

/* ------------------------------------------------------------------ CORS */
app.use(cors({
  origin(origin, cb) {
    // allow no-origin (same-origin dashboard, curl, health checks) and configured origins
    if (!origin || ALLOWED_ORIGIN.includes('*') || ALLOWED_ORIGIN.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  maxAge: 86400
}));

/* ------------------------------------------------ tiny in-memory rate limit */
// Real client IP: Render/proxies set X-Forwarded-For (trust proxy handles it);
// Cloudflare (if ever in front) sets CF-Connecting-IP.
function clientIp(req) { return req.get('cf-connecting-ip') || req.ip || 'unknown'; }

const hits = new Map(); // ip -> [timestamps]
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ ok: false, error: 'Too many requests — please slow down.' });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}
// occasional cleanup so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const keep = arr.filter(t => now - t < 3600_000);
    if (keep.length) hits.set(ip, keep); else hits.delete(ip);
  }
}, 3600_000).unref();

/* ---------------------------------------------------------------- helpers */
// Wrap async route handlers so a rejected promise reaches the error middleware.
const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function clip(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}
/* ----------------------------------------------------------------- routes */
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Public: record an RSVP
app.post('/api/rsvp', rateLimit({ windowMs: 3600_000, max: 30 }), asyncH(async (req, res) => {
  const b = req.body || {};
  const name = clip(b.name, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required.' });

  // Phone is required and is the dedupe key: the same number updates the
  // existing RSVP instead of creating a duplicate. phone_key = digits only.
  const phone = clip(b.phone, 40);
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) {
    return res.status(400).json({ ok: false, error: 'A valid phone / WhatsApp number is required.' });
  }
  // Key on the last 10 digits so "9876543210" and "+91 98765 43210" match.
  const phoneKey = digits.slice(-10);

  let guests = parseInt(b.guests, 10);
  if (!Number.isFinite(guests) || guests < 1) guests = 1;
  if (guests > 5) guests = 5;

  // Normalise attendance to two canonical values.
  const raw = clip(b.attending, 40);
  const attending = /unable|won'?t|can'?t|\bno\b|not/i.test(raw) ? 'Unable to attend' : 'Yes, joyfully';

  // Upsert by phone_key: a repeat submission from the same number updates the row.
  const { rows } = await pool.query(
    `INSERT INTO rsvp (name, phone, phone_key, guests, attending, message, ip, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (phone_key) DO UPDATE SET
       name       = EXCLUDED.name,
       phone      = EXCLUDED.phone,
       guests     = EXCLUDED.guests,
       attending  = EXCLUDED.attending,
       message    = EXCLUDED.message,
       ip         = EXCLUDED.ip,
       updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [name, phone, phoneKey, guests, attending, clip(b.message, 2000), clientIp(req).slice(0, 45)]
  );
  const row = rows[0];
  res.status(row.inserted ? 201 : 200).json({ ok: true, id: row.id, updated: !row.inserted });
}));

// Public: full guest list
app.get('/api/rsvp', asyncH(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, phone, guests, attending, message, created_at
     FROM rsvp ORDER BY id DESC`
  );
  res.json({ ok: true, entries: rows });
}));

// Public: live aggregate counts (one round-trip)
app.get('/api/stats', asyncH(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int                                                                AS total,
      (COUNT(*) FILTER (WHERE attending = 'Yes, joyfully'))::int                   AS "attendingYes",
      (COUNT(*) FILTER (WHERE attending = 'Unable to attend'))::int                AS "attendingNo",
      COALESCE(SUM(guests) FILTER (WHERE attending = 'Yes, joyfully'), 0)::int     AS "guestsComing",
      MAX(created_at)                                                              AS latest
    FROM rsvp
  `);
  const r = rows[0];
  res.json({
    ok: true,
    total: r.total,
    attendingYes: r.attendingYes,
    attendingNo: r.attendingNo,
    guestsComing: r.guestsComing,
    latest: r.latest || null,
    serverTime: new Date().toISOString()
  });
}));

// The dashboard page (static, public).
app.get(['/dashboard', '/dashboard/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/', (req, res) => res.redirect('/dashboard'));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// JSON error handler (async route failures land here)
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error('request failed:', err);
  res.status(500).json({ ok: false, error: 'Server error.' });
});

/* ----------------------------------------------------------------- start */
async function start() {
  await init();                       // ensure the table exists before serving
  return new Promise((resolve) => {
    const server = app.listen(PORT, () =>
      console.log(`RSVP server listening on :${PORT}  (origins: ${ALLOWED_ORIGIN.join(', ')})`));
    resolve(server);
  });
}

if (require.main === module) {
  start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
}

module.exports = { app, start };
