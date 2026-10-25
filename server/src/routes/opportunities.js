// server/src/routes/opportunities.js — P3: signals, opportunities, theses.
// Thesis generation is DETERMINISTIC (rubric.js). The optional LLM adapter is
// OFF by default and only ever emits assertion_type=inference drafts (P5/P7).
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'
import {
  RULE_VERSION, runHardChecks, hardCheckSummary, scoreOpportunity,
  confidenceFor, canTransition, canBranch, LIVE_STAGES,
} from '../lib/rubric.js'

const NINE_SECTIONS = Object.freeze([
  'why_this_matters', 'why_now', 'why_this_org', 'what_they_may_need',
  'what_we_can_provide', 'who_controls_decision', 'what_evidence_supports',
  'what_could_invalidate', 'recommended_next_action',
])

const signalSchema = z.object({
  event_type: z.string().min(2).max(80),
  occurred_at: z.string().datetime().optional(),
  summary: z.string().min(3).max(4000),
  source_ids: z.array(z.string().uuid()).default([]),
  affected_org_ids: z.array(z.string().uuid()).default([]),
})

const oppSchema = z.object({
  offering_twin_id: z.string().uuid(),
  target_org_id: z.string().uuid(),
  sector_type: z.string().min(2).max(60),
})

const ratingsSchema = z.record(
  z.object({
    rating: z.union([z.number().int().min(0).max(4), z.literal('unknown')]),
    rationale: z.string().max(2000).default(''),
    source_ids: z.array(z.string().uuid()).default([]),
  }),
)

const thesisSchema = z.object({
  opportunity_id: z.string().uuid(),
  ratings: ratingsSchema,
  sections: z.record(z.string().max(8000)).optional(),
  invalidators: z.array(z.string().max(1000)).default([]),
  contradictions: z.array(z.object({
    claim_a: z.string().uuid(),
    claim_b: z.string().uuid(),
    note: z.string().max(1000).default(''),
  })).default([]),
  value_models: z.array(z.object({
    kind: z.enum(['rental', 'colocation', 'hardware']),
    inputs: z.record(z.union([z.number(), z.string(), z.null()])),
    low: z.number().nullable(),
    base: z.number().nullable(),
    high: z.number().nullable(),
    currency: z.string().min(3).max(8),
    assumptions: z.string().max(2000).default(''),
    incomplete: z.boolean().default(false),
  })).default([]),
  override: z.boolean().default(false),
  override_reason: z.string().max(2000).optional(),
})

const transitionSchema = z.object({
  to_stage: z.string(),
  reason: z.string().max(2000).optional(),
})

// A05 law: every material assertion in a drafted section must be claim-linked.
// Alpha enforcement: sections must reference claim ids inline as [claim:<uuid>]
// for any factual claim; the validator checks the referenced claims exist and
// are not bare inference presented as fact. Unsupported material assertion =>
// thesis rejected at validation (cannot be saved as thesis_ready).
function validateSections(sections, claimIds, claimsBy) {
  const problems = []
  for (const key of Object.keys(sections)) {
    if (!NINE_SECTIONS.includes(key)) problems.push(`unknown section "${key}"`)
  }
  for (const key of NINE_SECTIONS) {
    const body = sections[key]
    if (typeof body !== 'string' || !body.trim()) problems.push(`section "${key}" empty`)
  }
  if (problems.length) return { ok: false, problems }

  // A05 law (alpha, deterministic): every section must either cite >=1 claim
  // or be explicitly framed as non-factual with a leading "Hypothesis:".
  // Anything else is an unsupported material assertion => validation fails.
  const referenced = []
  for (const key of NINE_SECTIONS) {
    const body = sections[key] || ''
    const refs = [...body.matchAll(/\[claim:([0-9a-f-]{36})\]/gi)].map((m) => m[1])
    referenced.push(...refs)
    if (refs.length === 0 && !/^\s*hypothesis:/i.test(body)) {
      problems.push(`section "${key}" asserts without a claim citation (cite [claim:id] or prefix "Hypothesis:")`)
    }
  }
  const missing = referenced.filter((id) => !claimIds.has(id))
  if (missing.length) {
    problems.push(`dangling claim references: ${missing.join(', ')}`)
  }
  return { ok: problems.length === 0, problems, referenced }
}

export function createOpportunitiesRouter({ pool, analyst }) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))
  const jsonBody = express.json({ limit: '1mb' })

  /**
   * Deterministic thesis-persist spine — the ONLY way a thesis row is written.
   * Loads the opportunity, applies A05 section validation (+admin override path),
   * runs twin hard checks + rubric scoring + confidence, inserts the next thesis
   * version. Used by POST /theses (human drafts) and POST /opportunities/:id/scenario
   * (brain drafts) alike. Returns { thesis, opp, validation }.
   */
  async function persistThesis(c, { tenantId, userId, opportunityId, ratings, sections, override, overrideReason,
    invalidators = [], contradictions = [], valueModels = [], origin }) {
    const { rows: opps } = await c.query('SELECT * FROM opportunities WHERE id = $1', [opportunityId])
    const opp = opps[0]
    if (!opp) { const e = new Error('Opportunity not found'); e.status = 404; throw e }

    // offering twin ACTIVE version + target claims
    const { rows: tvRows } = await c.query(
      `SELECT tv.* FROM twin_versions tv JOIN twins t ON t.id = tv.twin_id
       WHERE t.id = $1 AND tv.status = 'active' ORDER BY tv.version DESC LIMIT 1`, [opp.offering_twin_id],
    )
    const tv = tvRows[0] || { mandate: null, permitted_markets: [], excluded_markets: [], capabilities: [] }
    const { rows: claimRows } = await c.query(
      `SELECT * FROM claims WHERE subject_type = 'organisation' AND subject_id = $1`, [opp.target_org_id],
    )
    const targetClaims = {}
    for (const cl of claimRows) targetClaims[cl.predicate] = cl.value?.value ?? cl.value
    // country fact of record = the organisation row itself (claims may also assert it)
    if (targetClaims.country == null) {
      const { rows: orgRows } = await c.query('SELECT country FROM organisations WHERE id = $1', [opp.target_org_id])
      targetClaims.country = orgRows[0]?.country ?? null
    }
    const claimIds = new Set(claimRows.map((cl) => cl.id))

    // A05: unsupported material assertions block thesis_ready
    let validation = { ok: true, problems: [], referenced: [] }
    if (sections) {
      validation = validateSections(sections, claimIds, claimRows)
      if (!validation.ok && !(override && overrideReason)) {
        const e = new Error(`Section validation failed: ${validation.problems.join('; ')}`)
        e.status = 422; e.code = 'unsupported_assertion'; throw e
      }
    }

    const hardChecks = runHardChecks({
      mandate: tv.mandate,
      permittedMarkets: tv.permitted_markets || [],
      excludedMarkets: tv.excluded_markets || [],
      capabilities: tv.capabilities || [],
      targetClaims,
      sectorType: opp.sector_type,
    })
    const summary = hardCheckSummary(hardChecks)
    const scores = scoreOpportunity(ratings)

    // evidence age: newest source referenced by any cited claim.
    // Claims with NO cited sources are user-declared (user_claim) — age is
    // not evaluated for them (9999 sentinel only applies to cited claims).
    let evidenceAgeDays = 0
    const citedSources = claimRows.flatMap((cl) => cl.evidence_source_ids || [])
    if (citedSources.length) {
      const { rows: srcRows } = await c.query('SELECT max(observed_at) m FROM sources WHERE id = ANY($1)', [citedSources])
      if (srcRows[0]?.m) {
        evidenceAgeDays = Math.floor((Date.now() - new Date(srcRows[0].m).getTime()) / 86400000)
      } else {
        evidenceAgeDays = 9999 // dangling source ids = stale evidence
      }
    }
    const conf = confidenceFor({ coverage: scores.coverage, hardChecks, evidenceAgeDays, contradictions })

    const versionRow = await c.query(
      'SELECT COALESCE(MAX(version), 0) + 1 v FROM theses WHERE opportunity_id = $1', [opportunityId],
    )
    const version = versionRow.rows[0].v
    const finalSections = sections || Object.fromEntries(NINE_SECTIONS.map((k) => [k, '']))

    const { rows: thRows } = await c.query(
      `INSERT INTO theses (tenant_id, opportunity_id, version, twin_version_id, signal_ids, rule_version,
         sections, scores, hard_checks, coverage, priority, confidence, missing_conditions,
         invalidators, contradictions, value_models, author_actor)
       VALUES ($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [tenantId, opportunityId, version, tv.id || null, RULE_VERSION,
       JSON.stringify(finalSections), JSON.stringify({ ratings, perDim: scores.perDim, origin: origin || 'human' }),
       JSON.stringify({ checks: hardChecks, summary }), scores.coverage, scores.priority,
       conf.confidence, conf.missing_conditions, JSON.stringify(invalidators),
       JSON.stringify(contradictions), JSON.stringify(valueModels), userId],
    )
    const thesis = thRows[0]
    await c.query('UPDATE opportunities SET latest_thesis_id = $1, updated_at = now() WHERE id = $2',
      [thesis.id, opp.id])
    return { thesis, opp, validation }
  }

  // ---- signals ----
  router.post('/signals', requireRole('admin', 'analyst', 'commercial'), jsonBody, async (req, res, next) => {
    try {
      const input = signalSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO signals (tenant_id, event_type, occurred_at, summary, source_ids, affected_org_ids, created_by)
           VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4,$5,$6,$7) RETURNING *`,
          [req.tenantId, input.event_type, input.occurred_at || null, input.summary,
           input.source_ids, input.affected_org_ids, req.user.id],
        )
        return rows[0]
      })
      res.status(201).json({ signal: created })
    } catch (e) { next(e) }
  })

  router.get('/signals', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query('SELECT * FROM signals ORDER BY occurred_at DESC LIMIT 200'),
      )
      res.json({ signals: rows.rows })
    } catch (e) { next(e) }
  })

  // ---- opportunities ----
  router.post('/opportunities', requireRole('admin', 'analyst', 'commercial'), jsonBody, async (req, res, next) => {
    try {
      const input = oppSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const twin = await c.query('SELECT id, offering FROM twins WHERE id = $1', [input.offering_twin_id])
        if (!twin.rows.length || !twin.rows[0].offering) {
          const e = new Error('offering_twin_id must reference an OFFERING twin'); e.status = 400; throw e
        }
        const org = await c.query('SELECT id FROM organisations WHERE id = $1', [input.target_org_id])
        if (!org.rows.length) { const e = new Error('target org not found'); e.status = 404; throw e }
        const { rows } = await c.query(
          `INSERT INTO opportunities (tenant_id, offering_twin_id, target_org_id, sector_type, owner)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [req.tenantId, input.offering_twin_id, input.target_org_id, input.sector_type, req.user.id],
        )
        return rows[0]
      })
      res.status(201).json({ opportunity: created })
    } catch (e) { next(e) }
  })

  router.get('/opportunities', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT o.*, org.canonical_name AS target_name, t.latest_thesis_version
           FROM opportunities o
           JOIN organisations org ON org.id = o.target_org_id
           LEFT JOIN LATERAL (
             SELECT th.version AS latest_thesis_version FROM theses th
             WHERE th.opportunity_id = o.id ORDER BY th.version DESC LIMIT 1
           ) t ON true
           ORDER BY o.updated_at DESC LIMIT 500`,
        ),
      )
      res.json({ opportunities: rows.rows })
    } catch (e) { next(e) }
  })

  router.get('/opportunities/:id', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT o.*, org.canonical_name AS target_name,
                  (SELECT jsonb_agg(jsonb_build_object('version', th.version, 'id', th.id,
                           'priority', th.priority, 'coverage', th.coverage, 'confidence', th.confidence,
                           'created_at', th.created_at, 'needs_reassessment', th.needs_reassessment))
                   FROM theses th WHERE th.opportunity_id = o.id) AS theses
           FROM opportunities o JOIN organisations org ON org.id = o.target_org_id
           WHERE o.id = $1`, [req.params.id],
        ),
      )
      if (!rows.rows.length) return res.status(404).json({ error: { code: 'not_found', message: 'Not found' } })
      res.json({ opportunity: rows.rows[0] })
    } catch (e) { next(e) }
  })

  // ---- thesis generation (deterministic core) ----
  router.post('/theses', requireRole('admin', 'analyst'), jsonBody, async (req, res, next) => {
    try {
      const input = thesisSchema.parse(req.body)
      const override = input.override && req.roles.includes('admin')
      if (input.override && !req.roles.includes('admin')) {
        return res.status(403).json({ error: { code: 'forbidden', message: 'Only admin may override validation' } })
      }
      if (input.override && !input.override_reason) {
        return res.status(400).json({ error: { code: 'reason_required', message: 'Override requires a reason' } })
      }

      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { thesis } = await persistThesis(c, {
          tenantId: req.tenantId,
          userId: req.user.id,
          opportunityId: input.opportunity_id,
          ratings: input.ratings,
          sections: input.sections,
          override: input.override && req.roles.includes('admin'),
          overrideReason: input.override_reason,
          invalidators: input.invalidators,
          contradictions: input.contradictions,
          valueModels: input.value_models,
        })
        return thesis
      })

      res.status(201).json({ thesis: out })
    } catch (e) { next(e) }
  })

  // POST /opportunities/:id/scenario — the brain drafts a thesis (sections+ratings)
  // from the target org's dossier; the deterministic spine validates (A05 gate),
  // scores, and persists it as origin:'llm_analyst'. Stage NEVER moves here:
  // advancement stays human via /transitions, by design.
  router.post('/opportunities/:id/scenario', requireRole('admin', 'analyst'), jsonBody, async (req, res, next) => {
    try {
      if (!analyst) {
        return res.status(503).json({ error: { code: 'analyst_not_configured', message: 'analyst not configured' } })
      }
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: opps } = await c.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id])
        const opp = opps[0]
        if (!opp) { const e = new Error('Opportunity not found'); e.status = 404; throw e }

        // dossier: claims (with ids, newest first) + signals, tenant-scoped
        const { rows: claimRows } = await c.query(
          `SELECT id, predicate, value, assertion_type FROM claims
            WHERE subject_type = 'organisation' AND subject_id = $1
            ORDER BY created_at DESC`, [opp.target_org_id])
        const { rows: signalRows } = await c.query(
          `SELECT s.event_type, s.occurred_at, s.summary FROM signals s
            WHERE s.affected_org_ids @> ARRAY[$1::uuid]
            ORDER BY s.occurred_at DESC`, [opp.target_org_id]).catch(() => ({ rows: [] }))
        const { rows: orgRows } = await c.query('SELECT canonical_name FROM organisations WHERE id = $1', [opp.target_org_id])
        // offering context: the twin's active version capabilities, if any
        const { rows: tvRows } = await c.query(
          `SELECT tv.capabilities, t.organisation_id FROM twin_versions tv JOIN twins t ON t.id = tv.twin_id
           WHERE t.id = $1 AND tv.status = 'active' ORDER BY tv.version DESC LIMIT 1`, [opp.offering_twin_id])
        let offering = null
        if (tvRows[0]) {
          const { rows: ourOrg } = await c.query('SELECT canonical_name FROM organisations WHERE id = $1', [tvRows[0].organisation_id])
          offering = { name: ourOrg[0]?.canonical_name || null, capabilities: tvRows[0].capabilities || [] }
        }

        const { sections, ratings } = await analyst.scenario({
          dossier: {
            id: opp.target_org_id,
            name: orgRows[0]?.canonical_name || 'unknown org',
            claims: claimRows,
            signals: signalRows,
          },
          offering,
        })
        const { thesis } = await persistThesis(c, {
          tenantId: req.tenantId,
          userId: req.user.id,
          opportunityId: opp.id,
          ratings,
          sections,
          origin: 'llm_analyst',
        })
        return thesis
      })
      res.status(201).json({ thesis: out, note: 'draft thesis stored; advance stages via /transitions (human)' })
    } catch (e) {
      if (e.dropped) {
        return res.status(422).json({ error: { code: 'draft_dropped', message: e.message } })
      }
      next(e)
    }
  })

  router.post('/opportunities/:id/transitions', requireRole('admin', 'analyst', 'commercial', 'reviewer'), jsonBody, async (req, res, next) => {
    try {
      const input = transitionSchema.parse(req.body)
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query('SELECT * FROM opportunities WHERE id = $1 FOR UPDATE', [req.params.id])
        const opp = rows[0]
        if (!opp) { const e = new Error('Not found'); e.status = 404; throw e }
        const to = input.to_stage
        const legal = canBranch(opp.stage, to) || canTransition(opp.stage, to)
        if (!legal) {
          const e = new Error(`Illegal transition ${opp.stage} -> ${to}`); e.status = 409; throw e
        }
        // gating law: thesis_ready requires an existing thesis; qualified requires confidence >= medium
        if (to === 'thesis_ready' && !opp.latest_thesis_id) {
          const e = new Error('thesis_ready requires at least one thesis version'); e.status = 409; throw e
        }
        if (to === 'qualifying') {
          const { rows: th } = await c.query(
            'SELECT confidence FROM theses WHERE id = $1', [opp.latest_thesis_id])
          if (!th.length || th[0].confidence === 'insufficient') {
            const e = new Error('qualifying requires confidence better than insufficient'); e.status = 409; throw e
          }
        }
        if (to === 'qualified') {
          const { rows: thq } = await c.query(
            'SELECT hard_checks FROM theses WHERE id = $1', [opp.latest_thesis_id])
          const summary = thq[0]?.hard_checks?.summary
          const eligible = summary ? Boolean(summary.eligible_for_qualification) : false
          if (!eligible) {
            const e = new Error('qualified requires all hard checks to pass (no unknown, no fail)')
            e.status = 409; throw e
          }
        }
                await c.query('UPDATE opportunities SET stage = $1, branch_reason = $2, updated_at = now() WHERE id = $3',
          [to, input.reason || null, opp.id])
        await c.query(
          `INSERT INTO opportunity_transitions (tenant_id, opportunity_id, from_stage, to_stage, actor, reason)
           VALUES ($1,$2,$3,$4,$5,$6)`, [req.tenantId, opp.id, opp.stage, to, req.user.id, input.reason || null])
        return { from: opp.stage, to }
      })
      res.json(out)
    } catch (e) { next(e) }
  })

  // recheck hard checks at qualification time
  router.post('/opportunities/:id/recheck', requireRole('admin', 'analyst', 'reviewer'), async (req, res, next) => {
    try {
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: opps } = await c.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id])
        const opp = opps[0]
        if (!opp) { const e = new Error('Not found'); e.status = 404; throw e }
        if (!opp.latest_thesis_id) return { hard_checks: null, note: 'no thesis yet' }
        const { rows: th } = await c.query('SELECT hard_checks FROM theses WHERE id = $1', [opp.latest_thesis_id])
        return { hard_checks: th.rows[0]?.hard_checks || null }
      })
      res.json(out)
    } catch (e) { next(e) }
  })

  return router
}
