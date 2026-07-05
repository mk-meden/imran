'use strict';
/**
 * Wedding RSVP API + admin dashboard.
 *
 *   POST /api/rsvp      public  — store one RSVP  (rate-limited, CORS-guarded)
 *   GET  /api/rsvp      admin   — list all entries (Bearer ADMIN_TOKEN)
 *   GET  /api/stats     admin   — live counts
 *   GET  /api/verify    admin   — check the admin token (dashboard login)
 *   GET  /dashboard     public  — the dashboard page (data itself is token-gated)
 *   GET  /health        public  — health check
 *
 * Config via env (see .env.example):
 *   PORT, DATA_DIR, ADMIN_TOKEN, ALLOWED_ORIGIN
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!ADMIN_TOKEN) {
  console.warn('[warn] ADMIN_TOKEN is not set — admin endpoints and the dashboard will refuse access until you set it.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);                 // behind Cloudflare Tunnel: trust the single proxy hop
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
// Real client IP: Cloudflare sets CF-Connecting-IP; fall back to socket/XFF.
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
function clip(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ ok: false, error: 'Server not configured: ADMIN_TOKEN missing.' });
  const hdr = req.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.get('x-admin-token') || '');
  if (!token || !safeEqual(token, ADMIN_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

/* --------------------------------------------------- prepared statements */
const insertStmt = db.prepare(`
  INSERT INTO rsvp (name, phone, guests, attending, message, created_at, ip)
  VALUES (@name, @phone, @guests, @attending, @message, @created_at, @ip)
`);
const listStmt = db.prepare(`
  SELECT id, name, phone, guests, attending, message, created_at
  FROM rsvp ORDER BY id DESC
`);

/* ----------------------------------------------------------------- routes */
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Public: record an RSVP
app.post('/api/rsvp', rateLimit({ windowMs: 3600_000, max: 30 }), (req, res) => {
  const b = req.body || {};
  const name = clip(b.name, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required.' });

  let guests = parseInt(b.guests, 10);
  if (!Number.isFinite(guests) || guests < 1) guests = 1;
  if (guests > 50) guests = 50;

  // Normalise attendance to two canonical values.
  const raw = clip(b.attending, 40);
  const attending = /unable|won'?t|can'?t|\bno\b|not/i.test(raw) ? 'Unable to attend' : 'Yes, joyfully';

  try {
    const info = insertStmt.run({
      name,
      phone: clip(b.phone, 40),
      guests,
      attending,
      message: clip(b.message, 2000),
      created_at: new Date().toISOString(),
      ip: clientIp(req).slice(0, 45)
    });
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error('insert failed:', err);
    res.status(500).json({ ok: false, error: 'Could not save RSVP.' });
  }
});

// Admin: full guest list
app.get('/api/rsvp', requireAdmin, (req, res) => {
  res.json({ ok: true, entries: listStmt.all() });
});

// Admin: live aggregate counts
app.get('/api/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) n FROM rsvp').get().n;
  const yes = db.prepare("SELECT COUNT(*) n FROM rsvp WHERE attending = 'Yes, joyfully'").get().n;
  const no = db.prepare("SELECT COUNT(*) n FROM rsvp WHERE attending = 'Unable to attend'").get().n;
  const guestsComing = db.prepare("SELECT COALESCE(SUM(guests),0) n FROM rsvp WHERE attending = 'Yes, joyfully'").get().n;
  const latest = db.prepare('SELECT created_at FROM rsvp ORDER BY id DESC LIMIT 1').get();
  res.json({
    ok: true,
    total,
    attendingYes: yes,
    attendingNo: no,
    guestsComing,
    latest: latest ? latest.created_at : null,
    serverTime: new Date().toISOString()
  });
});

// Admin: token check (used by dashboard login)
app.get('/api/verify', requireAdmin, (req, res) => res.json({ ok: true }));

// The dashboard page (static). Its data is protected by the token, not the page.
app.get(['/dashboard', '/dashboard/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/', (req, res) => res.redirect('/dashboard'));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

const server = app.listen(PORT, () => console.log(`RSVP server listening on :${PORT}  (origins: ${ALLOWED_ORIGIN.join(', ')})`));
module.exports = server;
