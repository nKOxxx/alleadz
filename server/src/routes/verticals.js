// server/src/routes/verticals.js — lane selection + preset application.
// One active lane per tenant (the A/B experiment unit is the tenant).
// Applying a preset seeds the mandate twin + stores the lane config, and
// emits `vertical.applied` (the vertical-commitment event in the funnel).

import { Router } from 'express'
import { z } from 'zod'
import { withTenant, withTxn } from '../db/pool.js'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { httpError } from '../lib/errors.js'
import { listLanes, getPreset } from '../lib/verticals.js'
import { trackEvent } from '../lib/events.js'

const MUTATOR_ROLES = ['admin', 'analyst', 'commercial']

export function createVerticalsRouter({ pool }) {
  const router = Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))

  // GET /api/verticals — curated lane catalog (static, no writes)
  router.get('/verticals', async (req, res, next) => {
    try {
      const current = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`SELECT lane FROM tenants WHERE id = $1`, [req.tenantId]).then((r) => r.rows[0]?.lane ?? null),
      )
      res.json({ lanes: listLanes(), current })
    } catch (err) { next(err) }
  })

  // POST /api/verticals/apply — select + seed a lane (idempotent re-apply allowed)
  router.post('/verticals/apply', requireRole(...MUTATOR_ROLES), async (req, res, next) => {
    try {
      const input = z.object({ lane: z.enum(['bank-frick', 'own-products']) }).parse(req.body ?? {})
      const preset = getPreset(input.lane)
      if (!preset) throw httpError(400, 'unknown_lane', 'Unknown vertical lane')

      const out = await withTxn(pool, async (c, setLocal) => {
        // tenant context GUCs first (RLS-FORCEd writes follow)
        await setLocal('app.tenant_id', req.tenantId)
        await setLocal('app.user_id', req.user.id)

        // offering org for the twin (idempotent by canonical name + tenant)
        const orgName = preset.twin.organisation
        let orgId
        const { rows: orgRows } = await c.query(
          `SELECT id FROM organisations WHERE tenant_id = $1 AND canonical_name = $2 LIMIT 1`,
          [req.tenantId, orgName],
        )
        if (orgRows.length) orgId = orgRows[0].id
        else {
          const { rows } = await c.query(
            `INSERT INTO organisations (tenant_id, canonical_name, entity_type)
             VALUES ($1, $2, 'provider') RETURNING id`, [req.tenantId, orgName],
        )
          orgId = rows[0].id
        }

        // seed the mandate twin + ACTIVE version (idempotent: one twin per org+offering)
        const { rows: twinRows } = await c.query(
          `SELECT t.id FROM twins t WHERE t.tenant_id = $1 AND t.organisation_id = $2 AND t.offering = true LIMIT 1`,
          [req.tenantId, orgId],
        )
        let twinId, version
        if (twinRows.length) {
          twinId = twinRows[0].id
          const { rows: vRows } = await c.query(
            `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM twin_versions WHERE twin_id = $1`, [twinId],
          )
          version = vRows[0].v
        } else {
          const { rows } = await c.query(
            `INSERT INTO twins (tenant_id, organisation_id, offering, owner_user_id)
             VALUES ($1, $2, true, $3) RETURNING id`, [req.tenantId, orgId, req.user.id],
          )
          twinId = rows[0].id
          version = 1
        }
        const v = preset.twin.version
        const { rows: tvRows } = await c.query(
          `INSERT INTO twin_versions (tenant_id, twin_id, version, status, mandate,
             permitted_markets, excluded_markets, objectives, capabilities, constraints, created_by)
           VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [req.tenantId, twinId, version, v.mandate,
           v.permitted_markets, v.excluded_markets, v.objectives,
           JSON.stringify(v.capabilities), JSON.stringify(v.constraints), req.user.id],
        )

        // upsert lane + preset row
        await c.query(`UPDATE tenants SET lane = $2 WHERE id = $1`, [req.tenantId, input.lane])
        await c.query(
          `INSERT INTO vertical_presets (tenant_id, key, config, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, key) DO UPDATE SET config = EXCLUDED.config`,
          [req.tenantId, input.lane, JSON.stringify({
            label: preset.label, exportTemplate: preset.exportTemplate,
            cueLexicon: preset.cueLexicon, gate: preset.gate,
            twin_version_id: tvRows[0].id,
          }), req.user.id],
        )
        await c.query(
          `INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id)
           VALUES ($1,$2,'vertical.apply','twin_version',$3)`,
          [req.tenantId, req.user.id, tvRows[0].id],
        )
        await trackEvent(c, req.tenantId, 'vertical.applied', {
          actorUserId: req.user.id, objectId: tvRows[0].id,
          metadata: { lane: input.lane },
        })
        return { lane: input.lane, twin_id: twinId, twin_version_id: tvRows[0].id }
      })

      res.status(201).json(out)
    } catch (err) { next(err) }
  })

  return router
}
