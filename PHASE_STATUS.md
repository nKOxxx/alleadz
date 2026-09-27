# PHASE_STATUS.md — ALLEADZ

| Phase | Name | Status | Evidence |
|---|---|---|---|
| 0 | Repository assessment + frozen contracts | **passed** | this repo scaffold; reuse assessment below; contracts frozen in `CONTRACTS.md`; briefs in `docs/phases/` |
| 1 | Workspace, twins, evidence foundation | **in_progress** | — |
| 2 | Account import + research queue | pending | — |
| 3 | Opportunity Thesis + explainable matching | pending | — |
| 4 | Decision owners, actions, approvals — ALPHA | pending | — |
| 5 | Bounded discovery + contact enrichment | pending | — |
| 6 | Cross-sector + ecosystem handoffs | pending | — |
| 7 | Pilot hardening + release | pending | — |

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
