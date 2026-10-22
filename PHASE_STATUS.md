# PHASE_STATUS.md — ALLEADZ

| Phase | Name | Status | Evidence |
|---|---|---|---|
| 0 | Repository assessment + frozen contracts | **passed** 2026-09-27 | this repo scaffold; reuse assessment below; contracts frozen in `CONTRACTS.md`; briefs in `docs/phases/` |
| 1 | Workspace, twins, evidence foundation | **passed** 2026-10-01 | commit `f4fd44d` — RLS foundation, 8/8 server tests, client shell + auth (3/3 client tests) |
| 2 | Account import + research queue | **passed** 2026-10-01 | commit `6ee881d` — CSV import preview/commit, RFC4180 parser, reconciliation (A03/A04 proven), 16/16 |
| 3 | Opportunity Thesis + explainable matching | **passed** 2026-10-01 | commit `1b9db85` — immutable thesis versions, rubric v1.1 (A06/A07), cite-or-hypothesis law (A05), 24/24 |
| 4 | Decision owners, actions, approvals — ALPHA | **passed** 2026-10-02 | commit `4e92111` — email-class law (A09), human-confirmed relationships, bind/revoke approvals, manual-send-only (A10/A11), 32/32 |
| 5 | Bounded discovery + contact enrichment | **passed** 2026-10-02 | commit `3079577` — SSRF-guarded discovery with caps, sha256 snapshots (A12/A13), 36/36 |
| 6 | Cross-sector + ecosystem handoffs | **passed** 2026-10-03 | commit `dd79ecf` — sector packs as config (A14), handoff envelope v1 (A15), qualified-only gate, 40/40 |
| 7 | Pilot hardening + release | **passed** 2026-10-04 | commits `8e23881` (shared-DB Render mode) + `7ba380d` (auth-limiter scope fix); live at alleadz.onrender.com; full suite 76/76 |

> NOTE (2026-10-22): status table was stale ("Phase 1 in progress") while all phases
> had shipped per git history — corrected from commit evidence above. Live-site audit
> same day found the deployed build predated `7ba380d` (429s on authenticated GET);
> redeploy forced via empty commit `c2d3aff`.

## Phase 0 findings (2026-09-27)

### Reuse assessment (inspected, with file references)

| Artifact | Verdict | Evidence |
|---|---|---|
| ALLEADZ-Demo.html v4 | **NOT FOUND on this machine** (`mdfind -name ALLEADZ` + home-wide find: 0 hits). Features rebuild from spec §2 description; demo ring/indigo-silver identity reimplemented per §12. | tool transcript 2026-09-27 |
| v0.2 brief, buyer profiles, provider/contact lists, SG/KR list references | **NOT FOUND** (same searches). Import becomes a Phase-2 schema-compatible CSV; if the user supplies files later they enter through the normal import path. | tool transcript 2026-09-27 |
| SWAMP / Specter legacy projects | **NOT FOUND, NOT IMPORTED** (spec: reuse assessment required, not assumed). | tool transcript 2026-09-27 |
| Sovereign Grid stack (`/Users/ares/sovereign-grid`) | **REUSED AS PATTERNS** (not a dependency): express factory + injectable pool/fetch (`server/src/app.js`), scrypt passwords (`server/src/auth/passwords.js`), bearer sessions (`server/src/auth/sessions.js`), deny-by-default role middleware (`server/src/middleware/roles.js`), RLS-scoped `withUser()` transactions (`server/src/db/pool.js`), generic error handler (`server/src/lib/errors.js`), security headers (`server/src/middleware/security-headers.js`), vitest harness with per-run scratch DB. | file inspections 2026-09-27 |
| SG git identity | same owner account (github.com/nKOxxx) — new repo `alleadz`. | `git remote -v` |

### Architecture decision (spec §11 default)

- **Modular monolith**: Express 4 + node-postgres + zod (server), React 19 +
  Vite (client), JS ESM throughout. No graph DB (spec §18 defers it), no
  external AI SDK (adapters behind an interface; the app must work with AI
  providers down).
- **Tenancy**: real Postgres **RLS, FORCE ROW LEVEL SECURITY** on every
  tenant-private table, keyed to `SET LOCAL app.tenant_id` per transaction
  (`withTenant()` helper). App-layer tenant checks are defence-in-depth on
  top — never the only layer. DB roles: migration role (DDL) vs app role
  (DML, no BYPASSRLS) per security baseline.
- **No implicit evidence approval**: every approval is a recorded actor
  decision on an immutable version.
- **Testing**: per-phase vitest suites + scratch-database isolation; every
  acceptance-matrix ID tested at its phase (spec §16).

### P0 gate check (spec §13)

- [x] one stack chosen
- [x] offering twin vs target entity separation encoded in contracts (`twins.offering boolean` + orgs separate from twins)
- [x] tenant ownership explicit for every record (`tenant_id NOT NULL` in every table contract)
- [x] all proposed reuse grounded in inspected files (table above)
- [x] phase briefs identify dependencies and tests (`docs/phases/`)
- [x] no backend claims until tested (status table starts empty of "passed" claims)

## Final sweep (2026-09-27)
- Prod https://alleadz.onrender.com healthy (`{"ok":true}`), commit `238caf2`.
- Prod smoke: register → org → person → contact → opportunity → plan all 201 (`SMOKE_OK`).
- Unauthed `/api/packs` → 401 (auth wall confirmed on prod).
- Showcase: nikolastojanow.com/projects/alleadz/ live (HTTP 200; HTTPS apex still
  serves shared `*.github.io` cert — GitHub issuance pending, watchdog monitors).
