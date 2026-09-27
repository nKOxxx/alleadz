# Phase 4 — Decision owners, actions, approvals — ALPHA

Depends on: P3 ✅ · Read: spec §8, §10–12.

## Deliverables
1. people / employments / contact_points / relationships per CONTRACTS.
   Contact classes + deliverability law enforced (published ≠ deliverable;
   patterns never inferred; functional inboxes never executive contacts).
2. Decision-role research tasks (technical/economic/procurement) per
   opportunity; rank by decision relevance + access evidence, not title.
3. Action plans: tasks (owner, due, dependency, status, completion evidence);
   outreach drafts citing internal evidence ids; voice profile (tenant-private
   tone examples); drafts must not assert unconfirmed need/budget.
4. Approvals: review decision (investigate|watch|reject|request_evidence) on
   immutable thesis version; action approval binds recipient+exact content+
   attachments+disclosure scope+expiry; ANY edit ⇒ revoked (enforced, tested).
5. Stage gates §10 transition matrix incl. handed_off requirements; decision
   log; manual outcome recording (12 outcome types).
6. Exports: approved CSV/JSON/thesis one-pager; export logged; NEVER marks
   sent. No sending capability exists anywhere in the codebase.
7. Queue upgrades: prioritize campaign by stage/type; saved views (client).

## Acceptance tests (gate)
- A09: publication evidence vs deliverability vs relevance separated
  (fixtures for each email class; pattern-guess attempt rejected).
- A10: edit recipient/content/attachment after approval ⇒ approval revoked +
  audit trail; export does not mark outreach sent.
- A11: one rental + one colocation fixture journey source→approved action
  with full audit history; no outbound message sent by the application.

**ALPHA CUT**: freeze features; release note for analyst-led trial.

Handoff per protocol.
