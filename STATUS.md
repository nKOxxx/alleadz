# STATUS — Alleadz
_Updated 2026-10-02. Outside-verified per DoD; no self-reported done._

## What this is
AI/VC intelligence workspace: deterministic triage → sourced_fact claims →
opportunity pipeline, with RLS-secured multi-tenancy and approve→bind→export
human gates. Server (express+pg+zod) + SPA client (React, vite) served
same-origin from the API process.

## Live state (verified 2026-10-02)
- **URL**: https://alleadz.onrender.com — root 200, serves the built SPA
- **Health**: /api/health → 200 `{"ok":true}`
- **Prod E2E (real browser)**: register workspace "PoW Prod Verify" →
  landed on authenticated shell, full nav, tenant persisted. Screenshots:
  `~/.hermes/alleadz_prod_shell.png` (+ local-flow `alleadz_v1_opportunity.png`)
- **CI**: run 36998926920 — client ✓ server ✓ (50/50, role-separated postgres
  on /tmp socket); security workflow ✓ (gitleaks + npm audit)
- **Deploy**: Render autoDeploy, commit 1090648, live at 11:04 UTC

## Tests
- Server: 50/50 via `npm test` (scratch-db harness; app pool connects as
  non-superuser `alleadz_app` so FORCE RLS bites — harness-law test enforces)
- Client: 3/3 vitest + build gate in CI
- Local full run: `DATABASE_URL='postgresql:///postgres?host=/tmp' npm test`

## Known gaps / next
- Email verification: dev returns token; prod logs it (P7 decision, no mailer yet)
- Research-queue enrichment sidecar (scrapling) is local-only; not wired to Render
- Demo data: prod workspace starts empty by design (no seeds)

## Laws honored here
- RLS: app never superuser; audit_events FORCE RLS
- No auto-send: export requires live human approval
- MIT-only UI deps; AGPL/Enterprise prohibited (DECISIONS.md)
- CI: pinned full-SHA actions, least-privilege permissions, role-separated tests
