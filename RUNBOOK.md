# ALLEADZ — Runbook

## Service
- **URL**: https://alleadz.onrender.com
- **Render service**: `srv-das85s7pn0mc73f848f0` (web_service, node, free, oregon)
- **Repo**: https://github.com/nKOxxx/alleadz (auto-deploy on push to main)
- **Health**: `GET /api/health` → `{"ok":true}`

## Database (SHARED-DB MODE — read this before any DB work)
Render free tier allows **one active free Postgres**. `sovereign-grid-db`
(`dpg-dar1o0g473hc739h2ut0-a`, expires **2026-10-25**) is that database.

- Alleadz owns the **`alleadz` schema** (29 tables); Sovereign Grid owns
  `public` (17 tables). Connection string is IDENTICAL for both apps;
  Alleadz isolates via `search_path=alleadz,public` set in
  `server/src/db/pool.js` + `server/src/db/migrate.js`.
- **Never** create tables in `public` from this repo. **Never** point SG
  tooling at the `alleadz` schema.
- Connection string lives in `/tmp/sg_render_ext.txt` on MacBitty (transient).
  To re-obtain after reboot: Render dashboard → sovereign-grid-db → Connections
  (or `render postgres connection-string dpg-dar1o0g473hc739h2ut0-a -c external`).
- **Migrations**: `DATABASE_URL="$(cat /tmp/sg_render_ext.txt)" node server/src/db/migrate.js`
  (applies pending *.sql into `alleadz` schema; tracked in `alleadz.schema_migrations`).
- **Dedicated-DB upgrade path** (when a paid plan or a second free slot exists):
  create PG → run migrate → set `DATABASE_URL` on this service → redeploy.
  Code change required: **none** (search_path no-ops if schema missing is FALSE —
  remove the `options` line in pool.js/migrate.js OR pre-create the schema; the
  `alleadz` schema is created idempotently by migrations only if public is in path… 
  in practice: run `CREATE SCHEMA alleadz` once on the new DB, then migrate).

## DB expiry — 2026-10-25
When sovereign-grid-db expires, BOTH apps lose their DB. Watchdog
(`sg_watch.sh`) alerts on SG side. Alleadz remediation = same-day: create new
PG (or upgrade plan), `CREATE SCHEMA alleadz`, run migrate, swap
`DATABASE_URL` env var on both services, redeploy. RTO ~15 min. Data loss =
everything in `alleadz` schema (demo tenant + any pilot data) — acceptable
for alpha; **pilot data must be exported before expiry** (backups below).

## Backups
Free tier has no automated backups. Manual dump before any destructive change:
`pg_dump "$(cat /tmp/sg_render_ext.txt)" --schema=alleadz -Fc -f ~/alleadz-dump-$(date +%F).dump`
Restore: `pg_restore -d "$URL" --schema=alleadz file.dump` (after `CREATE SCHEMA alleadz`).

## Demo tenant
A synthetic demo tenant exists on prod (registered 2026-09-27, names suffixed
"synthetic"; credentials auto-generated, NOT stored anywhere — register a fresh
one if lost; data model supports unlimited tenants).

## Scrapling stealth sidecar (optional, local/dev)
- What: BSD-3-Clause Scrapling (Camoufox stealth browser) behind a localhost-only
  FastAPI sidecar; gives discovery a second transport for bot-challenged pages.
- Run: `~/.scrapling-venv/bin/python -m uvicorn sidecar.scrapling_sidecar:app --host 127.0.0.1 --port 8185` (from repo root)
- Enable: start server with `SCRAPLING_URL=http://127.0.0.1:8185`, then
  `POST /api/discovery/run {"urls":[...],"stealth":true}`. Without the env var or
  flag, behavior is identical to before (additive contract).
- Guards mirror lib/discovery.js: http(s) only, SSRF blocklist incl. DNS-resolved
  private IPs, 2 MB cap, 20s timeout. Every stealth failure falls back to direct
  fetch and is recorded in the run row (`via` field).
- Deployment law: sidecar is local/dev-only (Render free tier = 1 Node service,
  no paid hosting). Prod keeps direct transport.

## Test floors (local)
- server: `cd server && npx vitest run` → **58/58** (needs local PG on /tmp socket;
  falls back to `DATABASE_URL`)
- client: `cd client && npx vitest --run` → **3/3**, `npm run build` clean
- The scratch-DB harness creates temp databases + a least-privilege
  `alleadz_app` role locally; it never touches Render.

## Retention analytics (2026-10-03)
- `events` table (migration 0006) records: auth.registered, discovery.run,
  discovery.analyze, signal.promoted, bundle.exported (value action).
- Weekly cohort report: `cd server && DATABASE_URL="$(cat /tmp/sg_render_ext.txt)" \
  node scripts/weekly-cohorts.mjs` — prints registration cohorts (d7/d30
  first-export) + event funnel. Best-effort emission never breaks actions.

## Local demo stack (screenshot/QA runs)
- Local server MUST use the `alleadz_app` role, never superuser: Postgres
  superusers/owners bypass RLS (locally that leaked cross-tenant rows —
  prod is unaffected since Render's role is non-superuser).
  `DATABASE_URL="postgresql://alleadz_app@/alleadz_demo?host=/tmp" PGPASSWORD=…`
- `RATE_LIMITS=off` env relaxes the auth limiter for UI-automation runs only
  (`server/src/index.js`; prod leaves it on).
- `client/vite.config.js` now has a `preview.proxy` for `/api` + `/auth` —
  `vite preview` (port 5173) needs it; `server.proxy` only applies to dev.
- End-to-end capture verified via `shoot.py` (python playwright): register →
  type idea → Create opportunity → lands on `/pipeline/:id`.

## Security-relevant facts
- `users.role` column exists ONLY in SG's `public.users` — if you see
  `null value in column "role"` in Alleadz logs, the pool's `search_path`
  options got lost: check `server/src/db/pool.js` (`options: '-c search_path=alleadz,public'`).
- Auth rate limit (10/min on `/api/auth/*`) is intentionally strict; global
  limiter 300/min/IP on everything else.
- Approvals: outreach export requires a live approval; any revoke kills export.
  The system never sends email — `GET /api/tasks/:id/export` produces a bundle
  a human sends manually.
