# ALLEADZ — Intelligence-to-Opportunity Operating System

Turns a change in the world into a specific, evidence-linked commercial
opportunity, identifies the decision owner, prepares an approach, and records
the human decision and outcome.

- Core object: the **Opportunity Thesis** (nine sections, evidence-linked).
- Wedge: GPU compute / GPU hardware / AI colocation origination.
- Architecture: schema-general (banks, manufacturers, sovereign funds, family
  offices are configuration, not code forks).
- Product promise: a serious user can explain *why this opportunity exists,
  why now, who decides, what next* from structured facts and evidence —
  without depending on an LLM narrative.

## Repository map

| Path | Purpose |
|---|---|
| `CONTRACTS.md` | Frozen data dictionary + API action contract (the law) |
| `PHASE_STATUS.md` | Which phase is active / passed / blocked |
| `DECISIONS.md` | Owner decision log (append-only) |
| `docs/phases/00…07` | Phase briefs: goal, deps, deliverables, exclusions, gate |
| `docs/handoffs/` | Completion handoff per finished phase |
| `server/` | Express + pg + zod modular monolith (API) |
| `client/` | React + Vite app shell |
| `SECURITY_BASELINE.md` | 18-point baseline + verification log (evidence or it didn't happen) |
| `.github/workflows/security.yml` | gitleaks + npm audit gates |

## Execution protocol (every session)

Spec §14 governs: read `PHASE_STATUS.md` + `CONTRACTS.md` + active phase brief
+ last handoff **before editing**. Implement only the active phase. Never
invent buyer needs, relationships, email addresses, or verification. Mark
unverified work as unverified. Stop at the phase boundary.

## Status

Phase 0 (assessment + frozen contracts). See `PHASE_STATUS.md`.

Owner: Nikola Stojanow · Spec: ALLEADZ v1.0 (2026-09-27) · AED peg 3.6725
