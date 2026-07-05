# Wedding RSVP — API + Live Dashboard

A tiny, self-contained backend for the **Imran & Dhiya** wedding site:

- `POST /api/rsvp` — the site's RSVP form submits here; each response is stored in **SQLite**.
- `GET /dashboard` — a **password-protected** live dashboard showing the count of
  responses, attendance split, guest headcount, and every entry (with search + CSV export).

Stack: **Node.js + Express + better-sqlite3**, published through a **Cloudflare Tunnel**
(automatic HTTPS), run with **Docker Compose**. Guest data lives only on your VPS.

---

## Why a Cloudflare Tunnel (and how it coexists with Wazuh)

Your VPS already runs **Wazuh**, whose dashboard owns **port 443** (and the manager/indexer
use 1514/1515/55000/9200). A second web server can't also bind 443, and — since the site is
served over HTTPS — the API must be HTTPS too.

A Cloudflare Tunnel solves both **without opening any inbound port**:

```
Internet ──HTTPS──> Cloudflare edge ──(outbound-only tunnel)──> VPS: cloudflared ──> app:3000 ──> SQLite
```

- The `app` container publishes **no host ports** — it's only reachable over the internal
  Docker network, via `cloudflared`.
- `cloudflared` makes an **outbound** connection to Cloudflare; **nothing new listens on the
  public interface**, so Wazuh's ports are untouched and your attack surface doesn't grow.
- HTTPS, DDoS protection, and your real VPS IP hiding come for free.

Containers are further hardened: non-root user, `no-new-privileges`, and all Linux
capabilities dropped.

**Requirement:** your domain must be on Cloudflare (free plan is fine — just point the
domain's nameservers at Cloudflare).

---

## 1. Create the tunnel in Cloudflare

1. Cloudflare **Zero Trust** dashboard → **Networks → Tunnels → Create a tunnel** → **Cloudflared**.
2. Name it (e.g. `wedding-rsvp`) → **Save**. Choose **Docker** as the environment and **copy the token**
   (the long string after `--token`). You'll paste it into `.env`.
3. On the tunnel's **Public Hostnames** tab → **Add a public hostname**:
   - **Subdomain:** `api`  · **Domain:** `yourdomain.com`  (→ `api.yourdomain.com`)
   - **Service type:** `HTTP`  · **URL:** `app:3000`

That's the whole routing config — the tunnel forwards `api.yourdomain.com` to the `app` container.

## 2. Get the files onto the VPS

```bash
git clone https://github.com/mk-meden/imran.git
cd imran/server
```

## 3. Configure secrets

```bash
cp .env.example .env
nano .env
```

| Var | Value |
|-----|-------|
| `TUNNEL_TOKEN` | the token you copied in step 1 |
| `ALLOWED_ORIGIN` | `https://mk-meden.github.io` (your live site origin — no trailing slash) |
| `ADMIN_TOKEN` | a long random secret — `openssl rand -hex 24` |

> `.env` is git-ignored. **Never commit it.** `ADMIN_TOKEN` is also the dashboard password.

## 4. Start

```bash
docker compose up -d --build
```

No firewall changes needed — **no inbound ports are opened**.

## 5. Verify

- In the Cloudflare Tunnels dashboard the tunnel shows **Healthy**.
- From anywhere: `curl https://api.yourdomain.com/health`  → `{"ok":true,...}`
- Confirm nothing new is listening publicly on the VPS (Wazuh's ports should be the only ones):
  ```bash
  sudo ss -tlnp | grep -E ':(80|443)'    # unchanged — only Wazuh, if anything
  ```

Open the dashboard: **`https://api.yourdomain.com/dashboard`** and enter your `ADMIN_TOKEN`.

## 6. Connect the website

In [`../index.html`](../index.html), set the one config value (top of the `<script>`, in `CONFIG`):

```js
apiBaseUrl: "https://api.yourdomain.com",   // no trailing slash
```

Commit & push — GitHub Pages redeploys, and the RSVP form saves straight to your VPS.
Until this is set, the form shows a friendly "not live yet" message instead of erroring.

---

## Everyday operations

```bash
docker compose logs -f app                # app logs
docker compose logs -f cloudflared        # tunnel logs
git pull && docker compose up -d --build  # update
docker compose restart                    # restart
docker compose down                       # stop (data volume kept)

# Back up the guest list (SQLite DB lives in the rsvp_data volume)
docker compose cp app:/app/data/rsvp.db ./rsvp-backup-$(date +%F).db
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

Rate limit: 30 submissions per IP/hour (real client IP via Cloudflare's `CF-Connecting-IP`).
Payloads capped at 16 KB; fields length-limited.

---

## Security notes

- **No inbound ports.** The API is reachable only through the Cloudflare Tunnel; the VPS
  firewall/Wazuh setup is unchanged.
- Guest data never leaves your VPS. The dashboard page is `noindex`; its data needs the token.
- Containers run **non-root**, with `no-new-privileges` and **all capabilities dropped**.
- Admin endpoints use timing-safe token comparison; the dashboard escapes every guest value
  (no stored-XSS from a malicious note).
- Keep `.env` private; use a long random `ADMIN_TOKEN`; rotate by editing `.env` and
  `docker compose up -d`.
- **Optional extra hardening:** put a Cloudflare **Access** policy in front of
  `api.yourdomain.com/dashboard` (Zero Trust → Access → Applications) so the dashboard also
  requires a Cloudflare login/one-time-PIN in addition to the admin password.

---

## Running without Docker (optional)

```bash
npm install
DATA_DIR=./data ADMIN_TOKEN=your-secret ALLOWED_ORIGIN=https://mk-meden.github.io node server.js
# then run `cloudflared tunnel run` (or your own HTTPS proxy) in front of localhost:3000
```
