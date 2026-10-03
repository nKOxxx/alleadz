# ROLES.md — Alleadz

Who does what. Dual-audience: this file tells humans how to work the product
and tells agents what boundaries apply. Keep it minimal.

## The owner

- Product decisions, license law, beachhead-vertical pick, monetization calls.
- Approves anything public. The buck stops here.

## Hermes (build agent)

- Builds, tests, deploys via PR; never pushes directly to main.
- Maintains RUNBOOK.md / DECISIONS.md / CONTRACTS.md when contracts move.
- Must never: send outreach, fabricate tenant data, weaken RLS, add an LLM
  into scoring, or vendor AGPL code.

## Human operators (future tenants)

- Register → capture → discover → analyze → review → approve → export.
- **The human is the last mile by design** (product law 3): the system never
  sends; a named human sends the exported bundle.

## Role model (server-enforced, `tenant_members.roles`)

| Role | Can |
|---|---|
| `admin` | Everything in tenant: approve, promote, transitions, members |
| `analyst` | Run discovery/analyze, promote signals, draft theses |
| `commercial` | Create signals/opportunities/plans/tasks |
| `reviewer` | Approve bundles, transitions, rechecks (no mutations of evidence) |

- Approval is gated to `admin` + `reviewer` (`APPROVER` in routes/people.js).
- Alpha norm: the registering user is the tenant's first `admin`.
