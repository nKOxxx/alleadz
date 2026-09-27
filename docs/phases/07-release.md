# Phase 7 — Pilot hardening & release

Depends on: P0–P6 passed · Read: spec §12, §16–18.

## Deliverables
1. Production deployment: Render web service + managed Postgres; secrets via
   Render env (never in repo); CORS allowlist; health probes; backups
   (managed daily) + documented restore procedure (restore-TESTED in a
   separate environment).
2. Monitoring: uptime + error alerting; logs exclude secrets and private
   prompt payloads by default (log scrubber test).
3. Operational runbook: deploy, migrate, rollback (previous image + migration
   compatibility rule), incident basics, scoped retention/deletion procedure.
4. Public site (showcase route on nikolastojanow.com) + hosted clickable demo
   with SYNTHETIC data only, distinct from the private workspace; iOS
   file-preview blank-screen failure case avoided (hosted web app, no shared
   HTML preview dependency).
5. Feature flags; usage/cost dashboard (AI adapter calls metered).
6. Release report: tested / untested / deferred — honest per spec §13 gate.
   A missing required capability BLOCKS the v1.0 label.

## Acceptance tests (gate)
- A17: restore demonstrated in a separate environment; public demo contains
  synthetic data only (automated scan: no fixture overlap with real imports).
- Full §16 matrix re-run green; §3.1 capability checklist each ✓ with evidence.

## Pilot note (honest limit)
The §17 observed pilot (2 operators, 30 accounts, 10 theses, 5 conversations,
2–4 weeks, thresholds) requires HUMAN operators and real counterparties.
Engineering-side P7 can be complete while the release stays at
"pilot-pending" status until the owner runs the pilot. This is a gate we
cannot self-certify and will not pretend to.

Handoff per protocol.
