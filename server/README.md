# Wedding RSVP — API + Live Dashboard

A tiny, self-contained backend for the **Imran & Dhiya** wedding site:

- `POST /api/rsvp` — the site's RSVP form submits here; each response is stored in **SQLite**.
- `GET /dashboard` — a **password-protected** live dashboard showing the count of
  responses, attendance split, guest headcount, and every entry (with search + CSV export).

Stack: **Node.js + Express + better-sqlite3**, reverse-proxied by **Caddy** (automatic HTTPS),
run with **Docker Compose**. No third-party services; the guest data lives only on your VPS.

---

## Why HTTPS is required

The wedding site is served over **HTTPS** (GitHub Pages). Browsers **block** an HTTPS page
from calling an `http://` or bare-IP endpoint (mixed content). So the API must be a real
**domain over HTTPS** — which is exactly what Caddy sets up for you automatically.

---

## 1. Point DNS at your VPS

Create a DNS **A record** (and `AAAA` if you use IPv6):

```
api.yourdomain.com  →  <your VPS public IP>
```

Wait until it resolves (`ping api.yourdomain.com` shows the VPS IP). Caddy needs this to
issue the TLS certificate.

## 2. Get the files onto the VPS

The whole `server/` folder is in your site repo, so on the VPS:

```bash
git clone https://github.com/mk-meden/imran.git
cd imran/server
```

(or `scp -r server/ user@vps:~/wedding-rsvp` if you prefer.)

## 3. Configure secrets

```bash
cp .env.example .env
nano .env
```

Fill in:

| Var | Value |
|-----|-------|
| `API_DOMAIN` | `api.yourdomain.com` (from step 1) |
| `ALLOWED_ORIGIN` | `https://mk-meden.github.io` (your live site origin — no trailing slash) |
| `ADMIN_TOKEN` | a long random secret — generate with `openssl rand -hex 24` |

> `.env` is git-ignored. **Never commit it.** The `ADMIN_TOKEN` is also the dashboard password.

## 4. Open the firewall & start

```bash
# allow HTTP/HTTPS (ufw example)
sudo ufw allow 80,443/tcp

docker compose up -d --build
```

That's it. Caddy fetches an HTTPS certificate on first run (may take ~30s).

## 5. Verify

```bash
curl https://api.yourdomain.com/health          # -> {"ok":true,...}
```

Open the dashboard: **`https://api.yourdomain.com/dashboard`** and enter your `ADMIN_TOKEN`.

## 6. Connect the website

In [`../index.html`](../index.html), set the one config value (top of the `<script>`, in `CONFIG`):

```js
apiBaseUrl: "https://api.yourdomain.com",   // no trailing slash
```

Commit & push — GitHub Pages redeploys, and the RSVP form now saves straight to your VPS.
Until this is set, the form shows a friendly "not live yet" message instead of erroring.

---

## Everyday operations

**See logs**
```bash
docker compose logs -f app
```

**Update after pulling new code**
```bash
git pull && docker compose up -d --build
```

**Back up the guest list** (the SQLite DB lives in the `rsvp_data` volume)
```bash
docker compose cp app:/app/data/rsvp.db ./rsvp-backup-$(date +%F).db
```

**Restart / stop**
```bash
docker compose restart
docker compose down          # stop (data volume is kept)
```

---

## API reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/rsvp` | none (CORS + rate-limited) | store an RSVP `{name, phone, guests, attending, message}` |
| `GET`  | `/api/rsvp` | `Authorization: Bearer <ADMIN_TOKEN>` | list all entries |
| `GET`  | `/api/stats` | Bearer | live counts (total, attending yes/no, guests coming) |
| `GET`  | `/api/verify` | Bearer | validate the admin token (dashboard login) |
| `GET`  | `/dashboard` | none (data is token-gated) | the dashboard page |
| `GET`  | `/health` | none | health check |

Rate limit: 30 submissions per IP per hour. Payloads capped at 16 KB; fields are length-limited.

---

## Running without Docker (optional)

```bash
npm install
DATA_DIR=./data ADMIN_TOKEN=your-secret ALLOWED_ORIGIN=https://mk-meden.github.io node server.js
```

Then put your own reverse proxy (nginx/Caddy) with TLS in front of `localhost:3000`.

---

## Security notes

- Guest data never leaves your VPS. The dashboard page is `noindex`; its data requires the token.
- Keep `.env` private; use a long random `ADMIN_TOKEN`; rotate it by editing `.env` and
  `docker compose up -d`.
- All admin endpoints use timing-safe token comparison; the dashboard escapes every guest
  value (no stored-XSS from a malicious note).
