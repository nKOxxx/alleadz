# Phase 5 — Bounded discovery & contact enrichment

Depends on: P4 demonstrated on real records · Read: spec §7–9, §11.

## Deliverables
1. Collection adapter interface + ONE adapter first: authorised public URL/RSS
   fetch (per-account scope). Optional search adapter behind explicit config.
   No undocumented endpoints, no sign-in bypass, no rate-limit evasion.
2. Pilot limits (hard caps in code): ≤10 pages/account/job, ≤3 transient
   retries/request, ≤20 accounts/campaign run, tenant-set monetary ceiling.
   Reaching a cap ⇒ partial + continuation task, never "complete".
3. research_jobs: queued|running|succeeded|partial|failed|cancelled;
   per-account progress; resumable without duplicating evidence (job state
   checkpointing); recurring collection OFF until configured.
4. Snapshots/excerpts: content hash, retrieved_at, lawful excerpt retention;
   disappeared page ⇒ labelled retrieval failure + retained snapshot, never
   invented quotes.
5. Untrusted content law: fetched pages are DATA, never instructions;
   size/time/content-type limits; SSRF guard (reject private-range IPs,
   redirects into private ranges, non-http(s) schemes); prompt-injection
   isolation tests; no tool access from fetch pipeline.
6. Extraction: role-change/date candidates become claims
   (assertion_type=sourced_fact ONLY with extractable locator; otherwise
   inference). Coverage report: pages attempted/succeeded per account; "not
   found" includes search scope + date.

## Acceptance tests (gate)
- A12: outage ⇒ partial + retry state; restart ⇒ no duplicate evidence;
  cost cap stops; failed sources visible; counts reconcile.
- A13: prompt-injection fixture page cannot trigger privileged actions;
  SSRF attempts (169.254.169.254, 10.x, localhost, redirect chains) rejected.

Handoff per protocol.
