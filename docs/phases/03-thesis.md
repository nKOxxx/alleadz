# Phase 3 — Opportunity Thesis & explainable matching

Depends on: P2 ✅ · Read: spec §5–7, §9–11, thesis schema in CONTRACTS.

## Deliverables
1. Signals UI/API (manual entry in alpha; live collection is P5): dated,
   sourced, links orgs + claims.
2. Opportunity creation (offering twin × target org × sector_type), stage
   machine server-enforced per §10 matrix (candidate → researching →
   thesis_ready → human_reviewed → qualifying → qualified → handed_off →
   outcome_recorded; watch/rejected branches with reasons, reopenable).
3. Hard constraint checks (pass/fail/unknown): mandate, geography
   (permitted/excluded markets), product fit, required capability,
   procurement eligibility, disqualifiers. Unknown ⇒ task + blocks
   confirmed-fit. These are deterministic functions over twin_versions +
   claims — no LLM.
4. Ranking rubric §9: weights {fit 35, trigger 25, timing 15, budget 15,
   access 10}; per-dimension rating 0–4|unknown + rationale + evidence;
   priority = Σ(w·r/4), unknown ⇒ 0 contribution; coverage = Σ(w | known).
   Both shown + hard-check results. Weights versioned (rule_version);
   manual override requires reason. Unknown-heavy ⇒ research queue membership.
5. Confidence rule engine: insufficient/low/medium/high per §9 initial rule;
   missing_conditions displayed.
6. Thesis drafting: nine fixed sections; every material assertion claim-linked
   (assertion law enforced); contradictions + invalidators; value models
   (rental: qty×hours×rate w/ utilization assumptions; colocation: kW×rate×
   months; hardware: BOM) with low/base/high + currency + assumptions; unknown
   inputs ⇒ incomplete range, never fabricated ARR.
7. Thesis versions immutable; refresh ⇒ new version; twin material change ⇒
   affected active theses flagged for reassessment.
8. AI adapter interface (openai-compatible via env; OFF by default): drafts
   schema-valid candidate sections from stored evidence only; output enters
   as assertion_type=inference; LLM outage degrades to manual flow.

## Acceptance tests (gate)
- A05: all nine render; unsupported material claim fails review validation.
- A06: hard fail / unknown / stale evidence / contradiction ⇒ correct
  eligibility + confidence effects (fixture cases).
- A07: identical inputs + rule_version ⇒ byte-identical scores; token volume
  fixture never produces ARR/budget/need.
- A08: rental-only lead fails colocation qualification; "15–20 MW unconfirmed"
  fixture never renders as available IT MW.

Handoff per protocol.
