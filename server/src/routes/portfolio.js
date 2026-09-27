// server/src/routes/portfolio.js — P6: sector packs (config), portfolio view,
// handoff envelope export (frozen contract; idempotent by event_id).
import express from 'express'
import { z } from 'zod'
import { randomUUID, createHash } from 'node:crypto'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'

// Sector packs are CONFIGURATION, not code paths (spec: prove generality by config).
const SECTOR_PACKS = {
  gpu_rental: {
    label: 'GPU rental',
    required_capability: 'GPU compute brokerage',
    value_model: 'rental',
    signals: ['procurement', 'expansion', 'funding'],
  },
  gpu_hardware: {
    label: 'GPU hardware',
    required_capability: 'GPU hardware supply',
    value_model: 'hardware',
    signals: ['procurement', 'tariff', 'funding'],
  },
  ai_colocation: {
    label: 'AI colocation',
    required_capability: 'Data centre capacity',
    value_model: 'colocation',
    signals: ['power', 'construction', 'procurement'],
  },
  gov_data_infra: {
    label: 'Government data infrastructure',
    required_capability: 'Data centre capacity',
    value_model: 'colocation',
    signals: ['policy', 'tender'],
  },
}

const envelopeSchema = z.object({
  opportunity_id: z.string().uuid(),
  event_type: z.enum(['opportunity.handoff', 'opportunity.update']),
  recipient: z.string().min(2).max(200),
  disclosure_scope: z.array(z.string().max(100)).min(1),
})

// allowlisted payload fields — nothing else leaves the system
const PAYLOAD_ALLOWLIST = ['target_name', 'sector_type', 'stage', 'priority', 'coverage', 'confidence', 'summary']

export function createPortfolioRouter({ pool }) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))

  router.get('/packs', (req, res) => {
    res.json({ packs: Object.fromEntries(Object.entries(SECTOR_PACKS).map(([k, v]) => [k, { label: v.label, value_model: v.value_model, signals: v.signals }])) })
  })

  // Portfolio view: all opportunities grouped by sector + stage with scores
  router.get('/portfolio', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT o.sector_type, o.stage, count(*)::int n,
                  round(avg(th.priority)::numeric, 3) avg_priority,
                  round(avg(th.coverage)::numeric, 3) avg_coverage
           FROM opportunities o
           LEFT JOIN theses th ON th.id = o.latest_thesis_id
           GROUP BY o.sector_type, o.stage ORDER BY o.sector_type, o.stage`,
        ),
      )
      res.json({ portfolio: rows.rows, packs: Object.keys(SECTOR_PACKS) })
    } catch (e) { next(e) }
  })

  // Handoff export (P6 contract): envelope + allowlisted payload only.
  router.post('/handoffs/export', requireRole('admin', 'reviewer', 'commercial'), express.json({ limit: '100kb' }), async (req, res, next) => {
    try {
      const input = envelopeSchema.parse(req.body)
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: opps } = await c.query('SELECT * FROM opportunities WHERE id = $1', [input.opportunity_id])
        const opp = opps[0]
        if (!opp) { const e = new Error('Opportunity not found'); e.status = 404; throw e }
        if (opp.stage !== 'qualified' && opp.stage !== 'handed_off') {
          const e = new Error(`Only qualified opportunities can be handed off (current: ${opp.stage})`); e.status = 409; throw e
        }
        const { rows: orgs } = await c.query('SELECT canonical_name FROM organisations WHERE id = $1', [opp.target_org_id])
        const { rows: th } = await c.query(
          'SELECT priority, coverage, confidence, sections FROM theses WHERE id = $1 ORDER BY version DESC LIMIT 1',
          [opp.latest_thesis_id])
        if (!th.length) { const e = new Error('No thesis for opportunity'); e.status = 409; throw e }

        const payload = {}
        payload.target_name = orgs[0]?.canonical_name || null
        payload.sector_type = opp.sector_type
        payload.stage = opp.stage
        payload.priority = th[0].priority
        payload.coverage = th[0].coverage
        payload.confidence = th[0].confidence
        payload.summary = th[0].sections?.why_this_matters || null
        for (const k of Object.keys(payload)) {
          if (!PAYLOAD_ALLOWLIST.includes(k)) delete payload[k]
        }

        const eventId = randomUUID()
        const envelope = {
          event_id: eventId,
          event_type: input.event_type,
          schema_version: '1',
          occurred_at: new Date().toISOString(),
          sender: `tenant:${req.tenantId}`,
          recipient: input.recipient,
          correlation_id: `opp:${opp.id}`,
          opportunity_id: opp.id,
          thesis_version: th[0].priority != null ? opp.latest_thesis_id : null,
          payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
          disclosure_scope: input.disclosure_scope,
        }
        return { envelope, payload }
      })
      res.status(201).json(out)
    } catch (e) { next(e) }
  })

  return router
}
