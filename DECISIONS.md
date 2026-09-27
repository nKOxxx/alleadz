# DECISIONS.md — append-only owner decision log

| Date | Decision | Rationale | Decided by |
|---|---|---|---|
| 2026-09-27 | Stack = Express 4 + node-postgres + zod + React 19/Vite (mirror of Sovereign Grid patterns), JS ESM modular monolith | Spec §11 default; proven patterns on this machine; one deploy path (Render) already authorized; no new heavy deps | owner authorization via build directive ("Build it… don't ask me for anything") |
| 2026-09-27 | Tenancy = Postgres RLS FORCE + per-transaction `app.tenant_id` GUC, app-layer checks as defence-in-depth | Spec §11 "database-level row policies provide defence in depth"; SG `withUser()` pattern proven, extended tenant-first | builder (P0 authority) |
| 2026-09-27 | Demo/brief/list artifacts treated as NOT FOUND; Phase 2 import accepts schema-compatible CSVs if user supplies them later | `mdfind` + home-wide searches: zero hits. Spec §2 forbids assuming unseen artifacts | builder (P0 authority, honest-gap rule) |
| 2026-09-27 | Auth = email+password (scrypt), bearer sessions, email verification token — no external IdP at v1 | Managed auth optional per spec §11; zero-dependency pattern proven in SG; MFA is baseline-ready later | builder (P0 authority) |
| 2026-09-27 | Sequencing: P0→P7 executed under the owner's standing multi-phase authorization; a FAILED gate still stops advancement | Spec §14 allows sequential execution "when the owner has explicitly authorised sequential multi-phase execution" — the build directive does; the gate rule is kept | owner directive + builder |
| 2026-09-27 | Shared-DB mode: alleadz schema inside sovereign-grid-db (free-tier one-PG limit); user didn't respond in 60m → non-destructive default chosen, fully reversible | zero risk to SG; dedicated DB is one env-var swap later | Hermes (autonomy grant: "don't ask me for anything") |

## 2026-09-27 — Twenty as CRM basis: UX-pattern adoption + MIT component use (options 1+3)
User directive: use twentyhq/twenty as the basis for the CRM part. Decision (user-approved):
- **Option 1**: keep Alleadz's own codebase; its UX follows Twenty's patterns
  (capture-first action, object dashboards, record views). No fork, no AGPL.
- **Option 3**: cherry-pick **MIT-licensed** Twenty packages only. Verified
  licenses: `twenty-ui` MIT, `twenty-shared` MIT, `twenty-client-sdk` MIT;
  `twenty-front-component-renderer` is AGPL — never vendor it.
  In use: `twenty-ui` (Toaster/Callout) via npm `twenty-ui@^2`.
- **Never** copy files marked `/* @license Enterprise */` (commercial license).
- AGPL files must not enter this repo: hosting for others + AGPL would force
  source disclosure of the whole derivative work.
