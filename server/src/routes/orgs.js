// server/src/routes/orgs.js
// Organisations + twins + twin_versions + sources + claims + audit.
// ALL queries run inside withTenant — RLS is the primary isolation; the
// explicit tenant_id in INSERTs is defence-in-depth and satisfies WITH CHECK.

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { withTenant } from '../db/pool.js'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { httpError } from '../lib/errors.js'

const MUTATOR_ROLES = ['admin', 'analyst', 'commercial']

const orgInput = z.object({
  canonical_name: z.string().min(1).max(200),
  entity_type: z.enum(['provider', 'buyer', 'partner', 'other']).default('other'),
  domains: z.array(z.string().regex(/^[\w.-]+\.[a-z]{2,}$/i)).max(20).default([]),
  aliases: z.array(z.string().min(1).max(200)).max(50).default([]),
  parent_id: z.string().uuid().nullable().optional(),
  country: z.string().min(2).max(80).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
})

const capabilitySchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(['claimed', 'evidenced', 'reviewed', 'expired']),
  since: z.string().datetime().nullable().optional(),
  source_ids: z.array(z.string().uuid()).max(50).default([]),
})

const twinVersionInput = z.object({
  mandate: z.string().max(6000).nullable().optional(),
  permitted_markets: z.array(z.string().min(1).max(80)).max(100).default([]),
  excluded_markets: z.array(z.string().min(1).max(80)).max(100).default([]),
  objectives: z.array(z.string().min(1).max(300)).max(50).default([]),
  capabilities: z.array(capabilitySchema).max(100).default([]),
  constraints: z.record(z.unknown()).default({}),
  status: z.enum(['draft', 'active']).default('draft'),
  source_ids: z.array(z.string().uuid()).max(100).default([]),
})

const sourceInput = z.object({
  kind: z.enum(['url', 'document', 'user_input']),
  url: z.string().url().max(2000).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  source_type: z.enum(['registry', 'press', 'filing', 'company_page', 'directory', 'user_declaration', 'other']).default('other'),
  published_at: z.string().datetime().nullable().optional(),
  excerpt: z.string().max(8000).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const claimInput = z.object({
  subject_type: z.enum(['organisation', 'person', 'opportunity', 'twin']),
  subject_id: z.string().uuid(),
  predicate: z.string().min(1).max(200),
  value: z.unknown(),
  unit: z.string().max(40).nullable().optional(),
  effective_start: z.string().date().nullable().optional(),
  effective_end: z.string().date().nullable().optional(),
  assertion_type: z.enum(['sourced_fact', 'user_claim', 'inference', 'unknown', 'disputed']),
  evidence_source_ids: z.array(z.string().uuid()).max(100).default([]),
  rationale: z.string().max(4000).nullable().optional(),
}).refine(
  (v) => v.assertion_type !== 'inference' || (v.rationale && v.rationale.length > 0),
  { message: 'inference claims require a rationale (spec §8)' },
)

async function audit(client, tenantId, actorId, action, objectType, objectId, version = null) {
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, object_version)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, actorId, action, objectType, objectId, version],
  )
}

export function createOrgsRouter({ pool }) {
  const router = Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))

  // --------------------------------------------------------- organisations
  router.post('/orgs', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = orgInput.parse(req.body ?? {})
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO organisations (tenant_id, canonical_name, entity_type, domains, aliases, parent_id, country, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [req.tenantId, input.canonical_name, input.entity_type, input.domains, input.aliases,
           input.parent_id ?? null, input.country ?? null, input.notes ?? null],
        )
        await audit(c, req.tenantId, req.user.id, 'org.create', 'organisation', rows[0].id)
        return rows[0]
      })
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  router.get('/orgs', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200)
      const offset = Math.max(Number(req.query.offset) || 0, 0)
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT *, count(*) OVER() AS total FROM organisations
           ORDER BY canonical_name LIMIT $1 OFFSET $2`,
          [limit, offset],
        ).then((r) => r.rows),
      )
      const total = rows.length ? Number(rows[0].total) : 0
      res.json({ organisations: rows, total, showing: rows.length, limit, offset })
    } catch (err) { next(err) }
  })

  router.get('/orgs/:id', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`SELECT * FROM organisations WHERE id = $1`, [req.params.id]).then((r) => r.rows),
      )
      if (!rows.length) throw httpError(404, 'not_found', 'Organisation not found')
      res.json(rows[0])
    } catch (err) { next(err) }
  })

  // ----------------------------------------------------------------- twins
  router.post('/twins', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = z.object({
        organisation_id: z.string().uuid(),
        offering: z.boolean().default(false),
        version: twinVersionInput,
      }).parse(req.body ?? {})
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: org } = await c.query(`SELECT id FROM organisations WHERE id = $1`, [input.organisation_id])
        if (!org.length) throw httpError(404, 'not_found', 'Organisation not found')
        const { rows } = await c.query(
          `INSERT INTO twins (tenant_id, organisation_id, offering, owner_user_id)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [req.tenantId, input.organisation_id, input.offering, req.user.id],
        )
        const twin = rows[0]
        const { rows: vRows } = await c.query(
          `INSERT INTO twin_versions (tenant_id, twin_id, version, status, mandate, permitted_markets,
             excluded_markets, objectives, capabilities, constraints, source_ids, created_by)
           VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [req.tenantId, twin.id, input.version.status, input.version.mandate ?? null,
           input.version.permitted_markets, input.version.excluded_markets, input.version.objectives,
           JSON.stringify(input.version.capabilities), JSON.stringify(input.version.constraints),
           input.version.source_ids, req.user.id],
        )
        await audit(c, req.tenantId, req.user.id, 'twin.create', 'twin', twin.id, 1)
        return { twin, version: vRows[0] }
      })
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  router.get('/twins', async (req, res, next) => {
    try {
      const orgId = req.query.org_id
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT t.*, o.canonical_name AS organisation_name FROM twins t
           JOIN organisations o ON o.id = t.organisation_id
           WHERE ($1::uuid IS NULL OR t.organisation_id = $1) ORDER BY o.canonical_name`,
          [orgId && /^[0-9a-f-]{36}$/i.test(String(orgId)) ? orgId : null],
        ).then((r) => r.rows),
      )
      res.json({ twins: rows, showing: rows.length })
    } catch (err) { next(err) }
  })

  router.get('/twins/:id', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: t } = await c.query(`SELECT * FROM twins WHERE id = $1`, [req.params.id])
        if (!t.length) throw httpError(404, 'not_found', 'Twin not found')
        const { rows: v } = await c.query(
          `SELECT * FROM twin_versions WHERE twin_id = $1 ORDER BY version DESC`,
          [req.params.id],
        )
        return { twin: t[0], versions: v }
      })
      res.json(rows)
    } catch (err) { next(err) }
  })

  // New VERSION (never edit an existing one — CONTRACTS immutability law).
  router.post('/twins/:id/versions', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = twinVersionInput.parse(req.body ?? {})
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: t } = await c.query(`SELECT id FROM twins WHERE id = $1`, [req.params.id])
        if (!t.length) throw httpError(404, 'not_found', 'Twin not found')
        const { rows: maxRow } = await c.query(
          `SELECT COALESCE(MAX(version), 0) AS v FROM twin_versions WHERE twin_id = $1`,
          [req.params.id],
        )
        const nextVersion = Number(maxRow[0].v) + 1
        const { rows } = await c.query(
          `INSERT INTO twin_versions (tenant_id, twin_id, version, status, mandate, permitted_markets,
             excluded_markets, objectives, capabilities, constraints, source_ids, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [req.tenantId, req.params.id, nextVersion, input.status, input.mandate ?? null,
           input.permitted_markets, input.excluded_markets, input.objectives,
           JSON.stringify(input.capabilities), JSON.stringify(input.constraints),
           input.source_ids, req.user.id],
        )
        // material change: flag active work for reassessment (flagging table
        // arrives with P3 opportunities; the audit trail is the P1 record)
        await audit(c, req.tenantId, req.user.id, 'twin.version.create', 'twin_version', rows[0].id, nextVersion)
        return rows[0]
      })
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  // --------------------------------------------------------------- sources
  router.post('/sources', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = sourceInput.parse(req.body ?? {})
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO sources (tenant_id, kind, url, publisher, source_type, published_at, excerpt, language, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [req.tenantId, input.kind, input.url ?? null, input.publisher ?? null, input.source_type,
           input.published_at ?? null, input.excerpt ?? null, input.language ?? null,
           input.notes ?? null, req.user.id],
        )
        await audit(c, req.tenantId, req.user.id, 'source.create', 'source', rows[0].id)
        return rows[0]
      })
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  router.get('/sources', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`SELECT * FROM sources ORDER BY created_at DESC LIMIT 200`).then((r) => r.rows),
      )
      res.json({ sources: rows, showing: rows.length })
    } catch (err) { next(err) }
  })

  // ---------------------------------------------------------------- claims
  router.post('/claims', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = claimInput.parse(req.body ?? {})
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        // evidence ids must reference sources in THIS tenant (RLS makes
        // cross-tenant sources invisible; verify explicitly for a clean 400)
        if (input.evidence_source_ids.length) {
          const { rows: src } = await c.query(
            `SELECT id FROM sources WHERE id = ANY($1::uuid[])`,
            [input.evidence_source_ids],
          )
          if (src.length !== input.evidence_source_ids.length) {
            throw httpError(400, 'unknown_source', 'Evidence references a source not in this workspace')
          }
        }
        const { rows } = await c.query(
          `INSERT INTO claims (tenant_id, subject_type, subject_id, predicate, value, unit,
             effective_start, effective_end, assertion_type, evidence_source_ids, rationale, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [req.tenantId, input.subject_type, input.subject_id, input.predicate,
           JSON.stringify(input.value ?? null), input.unit ?? null,
           input.effective_start ?? null, input.effective_end ?? null,
           input.assertion_type, input.evidence_source_ids, input.rationale ?? null, req.user.id],
        )
        await audit(c, req.tenantId, req.user.id, 'claim.create', 'claim', rows[0].id)
        return rows[0]
      })
      res.status(201).json(created)
    } catch (err) { next(err) }
  })

  router.get('/claims', async (req, res, next) => {
    try {
      const subjectType = z.enum(['organisation', 'person', 'opportunity', 'twin']).parse(req.query.subject_type)
      const subjectId = z.string().uuid().parse(req.query.subject_id)
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT * FROM claims WHERE subject_type = $1 AND subject_id = $2 ORDER BY created_at DESC LIMIT 200`,
          [subjectType, subjectId],
        ).then((r) => r.rows),
      )
      res.json({ claims: rows, showing: rows.length })
    } catch (err) { next(err) }
  })

  // ----------------------------------------------------------------- audit
  router.get('/audit', requireRole('admin'), async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500)
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1`, [limit]).then((r) => r.rows),
      )
      res.json({ events: rows, showing: rows.length })
    } catch (err) { next(err) }
  })

  return router
}

export { audit as writeAudit }
export const _internal = { randomUUID } // re-exported for tests that stub ids
