# Phase 0 — Repository assessment & frozen contracts

Status: **PASSED** (2026-09-27). See `PHASE_STATUS.md` for the full findings.

## Outputs
- Reuse/discard assessment with inspected file references (PHASE_STATUS.md)
- Architecture decision + data dictionary (`CONTRACTS.md`)
- Owner decision log (`DECISIONS.md`)
- Phase briefs `docs/phases/01…07` with gates + test IDs
- Repo scaffold: server/client skeletons, security baseline, CI gates

## Gate evidence
- Stack chosen: Express 4 + pg + zod + React 19/Vite (DECISIONS.md #1)
- Offering twin vs target separation: `twins.offering` boolean + orgs are
  separate from twins (CONTRACTS.md)
- Tenant ownership explicit: every table contract begins with tenant_id;
  RLS FORCE chosen as the enforcement layer (DECISIONS.md #2)
- Reuse grounded in inspection: SG file list + read of passwords.js /
  middleware/auth.js / pool.js / app.js (2026-09-27 transcripts)
- No backend functionality claimed before tests exist (P1 will bring the
  first executable claims)
