# DECISIONS.md — append-only owner decision log

| Date | Decision | Rationale | Decided by |
|---|---|---|---|
| 2026-09-27 | Stack = Express 4 + node-postgres + zod + React 19/Vite (mirror of Sovereign Grid patterns), JS ESM modular monolith | Spec §11 default; proven patterns on this machine; one deploy path (Render) already authorized; no new heavy deps | owner authorization via build directive ("Build it… don't ask me for anything") |
| 2026-09-27 | Tenancy = Postgres RLS FORCE + per-transaction `app.tenant_id` GUC, app-layer checks as defence-in-depth | Spec §11 "database-level row policies provide defence in depth"; SG `withUser()` pattern proven, extended tenant-first | builder (P0 authority) |
| 2026-09-27 | Demo/brief/list artifacts treated as NOT FOUND; Phase 2 import accepts schema-compatible CSVs if user supplies them later | `mdfind` + home-wide searches: zero hits. Spec §2 forbids assuming unseen artifacts | builder (P0 authority, honest-gap rule) |
| 2026-09-27 | Auth = email+password (scrypt), bearer sessions, email verification token — no external IdP at v1 | Managed auth optional per spec §11; zero-dependency pattern proven in SG; MFA is baseline-ready later | builder (P0 authority) |
| 2026-09-27 | Sequencing: P0→P7 executed under the owner's standing multi-phase authorization; a FAILED gate still stops advancement | Spec §14 allows sequential execution "when the owner has explicitly authorised sequential multi-phase execution" — the build directive does; the gate rule is kept | owner directive + builder |
| 2026-09-27 | Shared-DB mode: alleadz schema inside sovereign-grid-db (free-tier one-PG limit); user didn't respond in 60m → non-destructive default chosen, fully reversible | zero risk to SG; dedicated DB is one env-var swap later | Hermes (autonomy grant: "don't ask me for anything") |

## 2026-09-27 — Twenty as CRM basis: UX-pattern adoption + MIT component use (options 1+3)
User directive: use twentyhq/twenty as the basis for the CRM part. Decision (user-approved):
- **Option 1**: keep Alleadz's own codebase; its UX follows Twenty's patterns
  (capture-first action, object dashboards, record views). No fork, no AGPL.
- **Option 3**: cherry-pick **MIT-licensed** Twenty packages only. Verified
  licenses: `twenty-ui` MIT, `twenty-shared` MIT, `twenty-client-sdk` MIT;
  `twenty-front-component-renderer` is AGPL — never vendor it.
  In use: `twenty-ui` (Toaster/Callout) via npm `twenty-ui@^2`.
- **Never** copy files marked `/* @license Enterprise */` (commercial license).
- AGPL files must not enter this repo: hosting for others + AGPL would force
  source disclosure of the whole derivative work.

## 2026-09-27 — Scrapling stealth transport (discovery layer)
- **Decision:** Adopt Scrapling (BSD-3-Clause, 84k stars) as an OPTIONAL second
  fetch transport for discovery, behind a localhost FastAPI sidecar
  (`sidecar/scrapling_sidecar.py`), enabled via `SCRAPLING_URL` env +
  `stealth:true` request flag. BSD-3 is license-safe (no AGPL disclosure risk;
  license law intact).
- **Why:** Modern marketing/press pages 403 plain fetch (proven: openai.com/news
  direct = 403/41 chars; stealth = 200/2,226 chars → 3 triage findings). Without
  stealth, the intelligence layer starves on exactly the pages that matter.
- **Laws kept:** SSRF/2MB/timeout caps mirrored in the sidecar; snapshots +
  content-hash still stored Node-side; no LLM; additive CONTRACTS (new optional
  field + `via` in response).
- **Deployment:** sidecar is local/dev-only (Render free tier = single service;
  no paid hosting). Prod uses direct transport until a second free-tier
  service (e.g. Fly) is justified.

## 2026-10-03 — Retention instrumentation: events table + value-action definition
- **Decision:** Every tenant-measurable action writes a row to `events`
  (migration 0006): `auth.registered`, `discovery.run`, `discovery.analyze`,
  `signal.promoted`, `bundle.exported`. Emission is best-effort and never
  fails the action it observes (`server/src/lib/events.js`).
- **Value action (Lieb retention law):** a tenant has received value when it
  **exports its first bundle** (`GET /api/tasks/:id/export` → 200 →
  `bundle.exported` event). Leading indicator: first `signal.promoted`.
  Weekly cohort curves are computed from these rows (never aggregates).
- **Why now:** founder-doctrine audit (2026-10-03) + Grok-blueprint audit
  both flagged zero instrumentation; blueprint Phase 4 law is "instrument
  BEFORE promotion". Zero tenants today = nothing lost, cheapest moment.
- **Not decided here:** beachhead vertical (owner call, pending).

2026-10-03 — Vertical lanes A/B (blueprint-audit fix 4). Two curated presets:
`bank-frick` (New Ventures client acquisition; >= USD 1M expected deposit;
sanctioned countries + Latin America excluded; retail excluded; 7 client
classes) and `own-products` (paying customers for Nybls / Sovereign Grid /
GulfWatch / KONTOR). One active lane per tenant — the A/B unit is the tenant;
funnels compare across lanes via the weekly cohort report (per-lane section).
Lane gate is a deterministic rubric hard check. New event: vertical.applied.
