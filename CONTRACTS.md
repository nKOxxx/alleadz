# CONTRACTS.md — frozen shared contracts (v1)

> The law. Phases may ADD tables/columns/endpoints; they may not redefine an
> object owned here. Changes require a DECISIONS.md entry with rationale.

## Identity & access

- **users**: id uuid pk, email citext unique, password_hash text
  (scrypt$N$r$p$salt$key), email_verified_at timestamptz null, created_at.
- **tenants**: id uuid pk, name text, created_at.
- **tenant_members**: tenant_id fk, user_id fk, roles text[] ⊆
  {admin, analyst, commercial, reviewer, viewer}, active boolean.
  Membership = the ONLY access grant. No default tenant. A client-supplied
  tenant id never confers access (server resolves membership; RLS enforces).

## Organisations & twins

- **organisations**: tenant_id, id, canonical_name, entity_type
  (provider|buyer|partner|other), domains text[], aliases text[], parent_id
  null, country, notes. Entity resolution (P2) never auto-merges; merges are
  reviewer actions with retained original rows.
- **twins**: tenant_id, id, organisation_id fk, offering boolean
  (TRUE = the seller/tenant org profile; FALSE = target profile), owner user_id.
  Target twins NEVER inherit offering capabilities.
- **twin_versions**: id, twin_id, version int, status
  (draft|active|superseded), mandate text, permitted_markets text[],
  excluded_markets text[], objectives text[], capabilities jsonb
  `[{name, status: claimed|evidenced|reviewed|expired, since, source_ids[]}]`,
  constraints jsonb (disqualifiers, risk limits, capacity), source_ids uuid[],
  created_by, created_at. **Immutable once any thesis references the version.**
  Material changes create a NEW version and flag affected active opportunities
  for reassessment.

## Evidence, claims, signals

- **sources**: tenant_id, id, kind (url|document|user_input), url null,
  publisher, source_type (registry|press|filing|company_page|directory|
  user_declaration|other), published_at null (unknown stays null),
  observed_at, retrieved_at, content_hash, excerpt text, language, notes.
- **claims**: tenant_id, id, subject_type (organisation|person|opportunity|
  twin), subject_id, predicate text, value jsonb, unit text, effective_start
  null, effective_end null, assertion_type ∈ {sourced_fact, user_claim,
  inference, unknown, disputed}, evidence_source_ids uuid[] (inference ⇒ empty
  array + rationale required), created_by, created_at.
  **An LLM inference is never a source; `assertion_type=inference` never cites
  evidence it did not itself derive from stored sources.**
- **signals**: tenant_id, id, event_type, occurred_at, summary, source_ids,
  claim_refs uuid[], affected_org_ids uuid[], related_signal_ids uuid[].

## Opportunity core (extended per phase)

- **opportunities**: tenant_id, id, offering_twin_id, target_org_id,
  sector_type (gpu_rental|gpu_hardware|ai_colocation|<pack-defined>), owner
  user_id, stage ∈ {candidate, researching, thesis_ready, human_reviewed,
  qualifying, qualified, handed_off, outcome_recorded} ∪ {watch, rejected}
  branches with reopen reasons, latest_thesis_id null, created_at, updated_at.
  Stage transitions enforced server-side (spec §10 matrix).
- **theses**: tenant_id, id, opportunity_id, version int, twin_version_id,
  signal_ids, rule_version text, sections jsonb (NINE keys, see below),
  scores jsonb `{{dim: {rating 0-4|unknown, rationale, source_ids}}}`,
  coverage numeric, priority numeric, confidence ∈
  {insufficient, low, medium, high} + missing_conditions text[],
  invalidators jsonb, contradictions jsonb, author_actor, created_at.
  Immutable; refresh ⇒ new version. Missing value renders "unknown", never 0.

**The nine sections (fixed keys)**: `why_this_matters, why_now, why_this_org,
what_they_may_need, what_we_can_provide, who_controls_decision,
what_evidence_supports, what_could_invalidate, recommended_next_action`.

## People & relationships (detailed in P4 brief)

- **people** / **employments** / **contact_points** (email_class ∈
  {person_published, company_published, third_party_reported, functional_inbox,
  non_commercial_inbox, not_found}; deliverability ∈ {untested, verified,
  failed} — published ≠ deliverable), **relationships** (evidence_refs +
  confirmed_by required; "No confirmed path" is a valid state).

## Actions & audit (detailed in P4 brief)

- action_plans, action_tasks, outreach_drafts, approvals (bind
  recipient+content+attachments+scope+expiry; ANY edit revokes),
  decisions, outcomes, audit_events (append-only: actor, action,
  object_type, object_version, payload_hash, correlation_id).

## Envelope contract (ecosystem, P6 — frozen now to avoid two definitions)

- envelope: `event_id uuid, event_type, schema_version "1",
  occurred_at, sender, recipient, correlation_id, opportunity_id,
  thesis_version, approved_by, approved_at, disclosure_scope string[],
  payload_hash` — JSON body = allowlisted fields only. Replay ⇒ same
  response, no duplicate side effects (idempotency key = event_id).

## API action contract (all under /api, JSON; zod-validated inputs; expected-version concurrency)

- Auth: POST /auth/register · POST /auth/login · POST /auth/verify ·
  POST /auth/logout. Bearer tokens.
- Tenancy resolution: every authenticated request carries
  `X-Tenant-Id`; server verifies membership → 403 otherwise; all queries run
  inside `withTenant(tenantId)` RLS transactions.
- P1: GET/PATCH /me · POST /orgs · GET /orgs · GET /orgs/:id ·
  POST /twins · GET /twins?org_id= · GET /twins/:id · POST /twins/:id/versions
  · POST /sources · GET /sources · POST /claims · GET /claims?subject= ·
  GET /audit (admin).
- Later phases add their actions per brief; P6 adds POST /handoffs/export
  (envelope above).

## Error & concurrency law

- Errors: `{error: {code, message, correlation_id}}` — generic messages at
  the edge; stack traces server-side only.
- Mutations carry `expected_version` where the object is versioned; mismatch
  ⇒ 409 conflict, never silent overwrite.
- Idempotency: mutations accept `Idempotency-Key`; stored per tenant+actor.
