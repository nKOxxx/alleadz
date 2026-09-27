# Phase 6 — Cross-sector proof & ecosystem handoffs

Depends on: P4 (+P5 for live feeds) · Read: spec §3, §5–6, §9–11, §15.

## Deliverables
1. Sector packs as CONFIGURATION: pack = {sector_types, qualification
   requirements, value model params, label} rows — core workflow code stays
   sector-agnostic. Fixtures: Bank Frick reference scenario (labelled
   synthetic targets), German manufacturer, Asian sovereign fund, African
   family office.
2. Portfolio view: multi-twin; qualified vs unqualified separated; related
   opportunities grouped (no value double-count); currency totals require
   sourced conversion date; shared target across twins ≠ two independent deals.
3. Competitive alternatives + procurement + partnership records per spec
   §3.2 (fields frozen in CONTRACTS; suggested ≠ agreed partner).
4. Handoff envelope (§15/CONTRACTS): export endpoint producing versioned
   JSON envelope, allowlisted payload only; replay idempotent (event_id);
   acknowledgement receipt handling for adapters; disclosure_scope enforced
   (denied fields never enter payload); revocation stops FUTURE transfers,
   exported copies honestly cannot be recalled (documented in UI copy).

## Acceptance tests (gate)
- A14: same core workflow serves all sector fixtures, no core forks; twin
  switch changes matched offer/constraints; tenant data stays isolated.
- A15: replayed handoff ⇒ identical response, one record; unauthorised
  fields excluded; with all integrations absent, core flows unaffected.

Handoff per protocol.
