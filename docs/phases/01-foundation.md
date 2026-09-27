# Phase 1 — Persistent workspace, twin & evidence foundation

Depends on: P0 ✅ · Read: spec §3–6, §8 (source contract), §11–12.

## Deliverables
1. Migrations 0001–0003: users/tenants/tenant_members; organisations/twins/
   twin_versions; sources/claims/signals; audit_events. RLS FORCE on every
   tenant-private table; migration role vs app role separation.
2. Auth: register (email+password scrypt, min 8), login, logout, email
   verification token (returned in dev/test, log-only in prod), session
   bearer middleware. Rate limits on register/login.
3. Tenancy: `withTenant(tenantId, fn)` — transaction + `SET LOCAL
   app.tenant_id`; membership resolved server-side from
   `X-Tenant-Id`; non-member ⇒ 403; missing header ⇒ 400.
4. Roles: admin/analyst/commercial/reviewer/viewer; viewer = read-only
   server-side on every mutating route.
5. Resources: organisations CRUD; twins + new-version action (immutability of
   referenced versions); sources; claims (assertion_type law enforced);
   audit_events written on every mutation; GET /audit admin-only.
6. Client shell: login/register, tenant switcher, nav (Opportunities/
   Intelligence/Organisations/Actions per §4), org+twin screens reading/writing
   the real API, evidence drawer on twins, indigo/silver + ring identity,
   useful empty states. Everything must survive reload.

## Exclusions
Bulk imports, matching, enrichment, crawling, sends, speculative future tables.

## Acceptance tests (gate)
- A01: tenant A token on tenant B org/twin/source/claim → 403/404; direct DB
  proof: withTenant(B) cannot select A rows (RLS test without app layer).
- A02: twin edit creates v2, v1 unchanged; evidence + claims persist across
  restart (supertest + fresh pool reconnect).
- A16 (first slice): 390px layout renders shell without clipping (client test).
- viewer mutation → 403; unauthenticated → 401 on all resource routes.
- assertion_type=inference with evidence_refs → 400 (law from §8).

Handoff: `docs/handoffs/01-foundation.md` with files, migrations, test output,
limitations, rollback (`migrate.js down` not supported → restore = drop schema;
documented).
