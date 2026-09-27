# Alleadz vs Twenty — CRM-Side Competitive Analysis

**Date:** 2026-09-27 · **Method:** Twenty built and run locally from source (commit @ main, 57.5k★), signed up, seeded identical scenario (Acme Dynamics / Jane Doe / pipeline idea), exercised via real UI + GraphQL. Alleadz exercised via API + UI with the same scenario.

## What was actually run
- Twenty: Node 24 + Postgres + Redis; `yarn install` (2,280 packages, 5.7 GB with node_modules), `twenty-shared` build, DB init, server (:3000) + front (:3001) + worker; full signup → workspace → profile onboarding via Playwright; records created via its GraphQL API; **custom object "Signal" created live via metadata API** (schema regenerated, appeared in nav, full CRUD — in ~30 seconds, no deploy).
- Alleadz: local stack (Express :8180 + Vite preview), fresh tenant, identical scenario seeded through its REST API; UI verified (pipeline list + record view with rubric).

## Headline numbers

| | **Twenty** | **Alleadz** |
|---|---|---|
| Source files (server+front) | 19,483 TS/TSX | 34 JS/JSX |
| Lines of code | ~1M+ (monorepo) | 3,729 |
| Dependencies installed | 2,280 | 175 (server+client) |
| Runtime memory (this test) | ~1.55 GB (server alone) | ~90 MB server + ~0 in prod (Render) |
| Infrastructure | Postgres + **Redis required** | Postgres only |
| API | GraphQL (119 queries / 392 mutations at root) | REST (7 route modules) |
| Frontend | React 18 + Jotai + Linaria + Vite | React 19 + plain CSS |

## Where Twenty is genuinely ahead (CRM table stakes)

1. **Custom objects (the killer feature).** I created a new "Signals" object at runtime through the metadata API — with fields, nav entry, generated GraphQL CRUD, filtering, views. Alleadz's data model is fixed (28 tables). This is the single biggest structural gap. Twenty is a *platform*; Alleadz is an *application*.
2. **Breadth of CRM surface.** Companies, People, Opportunities, Tasks, Notes, Attachments, Dashboards, Workflows, Calendar sync, Messaging/email sync (Gmail/Outlook import pipelines exist server-side), Favorites, Views (saved per-object views with filters/sort), Record sharing, Kanban/table views, Command menu (⌘K), Timeline activities per record, Notes/tasks as linked activities, CSV import/export, webhooks, API keys, RBAC (roles/role-targets/permissions), SSO/SAML, 2FA, audit-grade event logs, agent chat threads (new AI surface).
3. **View engine.** Every object gets saved views: filter/sort/visibility per user, kanban grouping by stage field. Alleadz has one fixed pipeline list + fixed stages.
4. **Ecosystem/agency.** Marketplace module, SDK/CLI for building apps and functions (logic-functions run server-side), MCP server support, REST + GraphQL + webhooks.
5. **Polish and depth of the table/board UX** (inline edit, field visibility, drag between board columns, row expansion, side panel).

## Where Alleadz wins (and Twenty will not follow)

1. **Evidence-linked opportunity model.** Alleadz: every scoring input must cite a `claim:uuid` or be framed `Hypothesis:`; the rubric is **deterministic** (no LLM scoring); thesis versions are immutable; stage machine is server-enforced. Twenty's opportunity = a record with a stage enum (NEW/SCREENING/MEETING/PROPOSAL/CUSTOMER) and an amount. There is no notion of evidence, rubric, thesis, or invalidators.
2. **Intelligence-native objects.** Alleadz's core is `signals → organisations → twins (offering/demand) → opportunities`, with a research queue, source provenance, and an approvals gate where **the system never sends** — bind-revoke human approval with manual export. Twenty has raw objects you could bend toward this, but no opinionated flow; you'd rebuild Alleadz's semantics as custom objects + workflow automations.
3. **Security posture by design.** RLS enforced (`FORCE RLS` + `SET LOCAL app.tenant_id`), least-privilege pool (never superuser/bypassrls), server-side stage machine. Twenty uses schema-per-workspace isolation (solid, different tradeoff) but is a general platform with a much larger attack surface (392 mutations, file uploads, webhooks, logic functions, SSO).
4. **Ops footprint.** Alleadz runs on Render **free tier** (no Redis). Twenty needs Redis + a real Postgres; self-hosting means the 5.7 GB monorepo or their Docker images; their cloud is paid per seat. Alleadz deploys from a 3.7k-line repo in minutes.
5. **Focus.** Twenty answers "manage any relationships generically." Alleadz answers "which of my ideas deserves to become an opportunity, and prove it." Different jobs.

## Honest verdict

- **As a general CRM**, Twenty beats Alleadz decisively — breadth (views, tasks, notes, calendar/email sync, dashboards, workflows, RBAC, SSO), custom objects, ecosystem. It's a 57.5k★ product with paid full-time team; that's expected.
- **As an intelligence-to-opportunity system**, nothing in Twenty implements Alleadz's differentiators: deterministic rubric, claim-cited scoring, immutable theses, human-only sending. Using Twenty as the CRM foundation would mean re-implementing all of Alleadz's product laws inside Twenty's custom-object/workflow machinery (buildable: custom objects Signals/Claims/Theses + workflow automations + API keys, but you'd own that config forever and inherit Twenty's upgrade treadmill).
- **Strategic takeaway:** keep Alleadz's engine, keep cherry-picking Twenty's UX patterns (already: Status, Avatar, Chip, Callout, Banner). Two concrete upgrades worth stealing next: **saved views/filters per object** and **⌘K command menu** — highest-perceived-power, lowest-build-cost.

## Sunk cost to note
Twenty local trial remains on disk at `~/twenty` (5.7 GB incl. node_modules; workspace DB `twenty_db` 14 MB). Delete with `rm -rf ~/twenty && dropdb -h /tmp -U twenty_user twenty_db` if we don't want it around.
