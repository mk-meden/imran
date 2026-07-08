# Wedding RSVP — API + Live Dashboard

A small backend for the **Imran & Dhiya** wedding site:

- `POST /api/rsvp` — the site's RSVP form submits here; each response is stored in **Postgres**.
- `GET /dashboard` — a **public** live dashboard (anyone with the link): response count,
  attendance split, guest headcount, and every entry (search + CSV export).

Stack: **Node.js + Express + Postgres (`pg`)**, deployed on **Render** (free web service,
automatic HTTPS) with a free **Neon** Postgres database. No servers to manage.

```
Guests ── https ──> Render web service (this app) ── TLS ──> Neon Postgres
                         │
                         └── /dashboard (public — anyone with the link)
```

---

## Step 1 — Create the database (Neon, free)

1. Sign up at **neon.tech** → **Create project** (any name/region near you).
2. On the project dashboard, open **Connection string** and copy the **Pooled** connection
   string. It looks like:
   ```
   postgresql://user:pass@ep-xxxx-pooler.REGION.aws.neon.tech/dbname?sslmode=require
   ```
   Keep it handy — it's your `DATABASE_URL`. (The app creates the `rsvp` table automatically
   on first boot.)

## Step 2 — Deploy the app on Render (free)

1. Push this repo to GitHub (already done: `mk-meden/imran`).
2. At **render.com** → **New + → Web Service** → connect the repo.
3. Configure:
   - **Root Directory:** `server`
   - **Runtime:** Docker (auto-detected from `server/Dockerfile`)
   - **Instance Type:** **Free**
   - **Health Check Path:** `/health`
4. **Environment variables** (Advanced → Add):
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Neon connection string from Step 1 |
   | `ALLOWED_ORIGIN` | `https://mk-meden.github.io` (no trailing slash) |
5. **Create Web Service.** Render builds and deploys; you'll get a URL like
   `https://wedding-rsvp.onrender.com`.

> **One-click alternative:** `server/render.yaml` is a Blueprint. In Render use
> **New + → Blueprint**, connect the repo, and it pre-fills everything except
> `DATABASE_URL` (which you paste in).

## Step 3 — Verify

```bash
curl https://wedding-rsvp.onrender.com/health      # -> {"ok":true,...}
```
Open **`https://wedding-rsvp.onrender.com/dashboard`** — it shows the live responses to anyone with the link.

## Step 4 — Connect the website

Tell me your Render URL and I'll set `apiBaseUrl` in [`../index.html`](../index.html) and push
(Pages redeploys and the form goes live). Or do it yourself: set
`apiBaseUrl: "https://wedding-rsvp.onrender.com"` in the `CONFIG` block, commit & push.

## Step 5 — Test end-to-end

Submit a test RSVP on the live site → "Thank you" confirmation → refresh the dashboard and
your entry + counts appear. 🎉

---

## Free-tier note: cold starts

Render's **free** web service **sleeps after ~15 minutes of inactivity**; the next request
wakes it, which can take **~30–60 seconds**. The form shows a "Sending…" state meanwhile, so
it still works — it's just slow on that first hit. Two ways to avoid it:

- **Keep it warm (free):** add a free uptime monitor (e.g. UptimeRobot or cron-job.org) that
  requests `https://wedding-rsvp.onrender.com/health` every ~10 minutes. One always-on free
  service stays within Render's free monthly hours.
- **Upgrade (paid):** Render **Starter ($7/mo)** is always-on with no cold starts.

Your **data is safe regardless** — it lives in Neon, not on Render's disk.

---

## API reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/rsvp` | none (CORS + rate-limited) | store an RSVP `{name, phone, guests, attending, message}` |
| `GET`  | `/api/rsvp` | none | list all entries |
| `GET`  | `/api/stats` | none | live counts (total, attending yes/no, guests coming) |
| `GET`  | `/dashboard` | none | the dashboard page (public) |
| `GET`  | `/health` | none | health check |

Rate limit: 30 submissions per IP/hour. Payloads capped at 16 KB; fields length-limited.

---

## Security notes

- **The dashboard is public** — anyone with the `/dashboard` link can see the full guest list
  (names, phone numbers, messages). It is `noindex` (won't show in search engines), but the
  URL is the only thing protecting it. Share it carefully. To re-add a password later, ask and
  it's a small change.
- Guest data lives in your Neon database (TLS-only). CORS is locked to `ALLOWED_ORIGIN`, and the
  dashboard escapes every guest value (no stored-XSS from a malicious note).
- Set env vars in the Render dashboard, never in the repo.

---

## Backups & local run

**Back up the guest list** (from any machine with `psql`):
```bash
pg_dump "$DATABASE_URL" -t rsvp > rsvp-backup.sql
```

**Run locally:**
```bash
npm install
DATABASE_URL="postgresql://...?sslmode=require" \
ALLOWED_ORIGIN=https://mk-meden.github.io \
npm start                     # http://localhost:3000/dashboard
```
