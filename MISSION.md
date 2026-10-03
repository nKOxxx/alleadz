# MISSION.md — Alleadz

**Dual-audience doc (blueprint Phase 1): humans AND agents read this.** Keep it
minimal — the bad-context-in law applies: more context isn't better context.

## Mission (one sentence)

Alleadz turns scattered public intelligence into human-approved outreach —
never sending anything itself.

## What we are

An intelligence-to-opportunity OS: capture (imports, discovery) → deterministic
extraction (no LLM in scoring) → thesis generation → human approval → export
bundle a human sends.

## Product laws (non-negotiable; full text in DECISIONS.md)

1. No LLM anywhere in scoring/triage — deterministic rubric only.
2. Cite-or-hypothesis: every claim carries sources or is labeled `Hypothesis:`.
3. The system never sends. Approve → bind → export; the last mile is human.
4. Immutable thesis versions; server-enforced stage machine.
5. RLS tenant isolation, enforced at the database.

## Value action (Lieb retention law)

- **Value action (retention "Aha"):** tenant **exports its first bundle**
  (`GET /api/tasks/:id/export` returns 200). That is the moment value is
  received. Leading indicator: first signal promoted to a claim.
- The `events` table measures this; weekly cohorts are computed from it.
- **Beachhead vertical: UNDECIDED** — owner decision pending (candidates:
  solo-GP deal flow, indie-SaaS competitive intel, recruiting pipelines).
  Do not pick one unilaterally.

## What we are NOT (un-ship list)

- No auto-sending. Ever. (Product law 3)
- No LLM-generated scores or triage. (Product law 1)
- No paid hosting; free-tier constraints are accepted, engineered around.
- No AGPL code; MIT-only adopted components (license law).

## Canonical URLs

- App: https://alleadz.onrender.com
- Health: GET /api/health → `{"ok":true}`
- Repo: github.com/nKOxxx/alleadz
