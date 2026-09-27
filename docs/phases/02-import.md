# Phase 2 — Account import & research queue

Depends on: P1 ✅ · Read: spec §7–8, §11–12, import schema in §11.

## Deliverables
1. Import: upload CSV (and XLSX if a zero-dep path exists; otherwise CSV-only
   documented), preview with sheet/header selection + column mapping UI,
   commit. Tables import_batches / import_rows per CONTRACTS (raw_values
   jsonb, row_number, disposition ∈ accepted|duplicate|rejected + reason).
2. Reconciliation law: accepted+duplicate+rejected == input rows (enforced +
   tested). Reimport idempotent at entity level (same domain/normalized name ⇒
   merge PROPOSAL, not silent dupe).
3. Entity resolution: normalize (lowercase, strip legal suffixes gmbh/ltd/
   llc/inc/fze/fzc), alias accumulation; reviewer merge/undo with retained
   original rows; identical names across tenants never merge.
4. Research queue: per-org research_status ∈ {pending, in_progress, researched,
   failed, excluded} + excluded_reason (strategic exclusions like hyperscalers
   are visible filters, never silent deletes). Filters + pagination with
   accurate counts ("Showing X of Y" contract).
5. CSV export round-trip preserving source ids, formula-injection escaping
   (prefix ' = + - @ with tab/newline guard).

## Acceptance tests (gate)
- A03: 100-row fixture → totals reconcile; reimport → 0 new dupes.
- A04: pagination/filter counts exact at 390px & desktop test level (API-level).
- Import of the demo provider-list schema (provider label ≠ legal entity:
  labels land as aliases on resolved orgs).
- Formula escaping unit tests (`=cmd|...`, `@SUM(...)`, `-2+3`, tabs).

Handoff per protocol.
