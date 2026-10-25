// server/src/routes/intelligence.js — signal triage over discovery snapshots.
// Deterministic only: findings come from lib/intelligence.js (regex/lexicon). No LLM.
// Evidence chain: discovery_run -> findings (quoted excerpt) -> source row -> signal ->
// promoted claim. A claim created here is 'sourced_fact' iff it carries evidence_source_ids.
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'
import { analyzeExtracted, findingConfidence } from '../lib/intelligence.js'
import { trackEvent } from '../lib/events.js'

async function audit(client, tenantId, actorId, action, objectType, objectId) {
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, actorId, action, objectType, objectId],
  )
}

const analyzeSchema = z.object({
  run_id: z.string().uuid(),
  organisation_id: z.string().uuid().nullable().optional(),
  mode: z.enum(['deterministic', 'llm']).optional(),
})

export function createIntelligenceRouter({ pool, analyst } = {}) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))
  const jsonBody = express.json({ limit: '100kb' })

  // POST /discovery/analyze — triage one snapshot into findings + a signal + source row.
  // Findings with confidence < 0.7 or missing published_at open research_tasks rows.
  router.post('/discovery/analyze', requireRole('admin', 'analyst'), jsonBody, async (req, res, next) => {
    try {
      const input = analyzeSchema.parse(req.body ?? {})
      // config errors are independent of the resource: check before touching the run
      if (input.mode === 'llm' && !analyst) { const e = new Error('analyst not configured'); e.status = 503; throw e }
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: runs } = await c.query(
          `SELECT id, organisation_id, requested_url, final_url, extracted, status
             FROM discovery_runs WHERE id = $1`,
          [input.run_id],
        )
        const run = runs[0]
        if (!run) { const e = new Error('discovery run not found'); e.status = 404; throw e }
        if (run.status !== 'ok') { const e = new Error('run did not succeed; nothing to analyze'); e.status = 409; throw e }

        // 1. source row = the evidence anchor for anything extracted from this snapshot
        const { rows: src } = await c.query(
          `INSERT INTO sources (tenant_id, kind, url, publisher, source_type, published_at, excerpt, created_by)
           VALUES ($1,'url',$2,$3,'company_page',$4,$5,$6) RETURNING id`,
          [req.tenantId, run.final_url || run.requested_url,
           hostOf(run.final_url || run.requested_url),
           run.extracted?.published_at || null,
           (run.extracted?.excerpt || '').slice(0, 1000) || null,
           req.user.id],
        )
        const sourceId = src[0].id

        // 1b. optional LLM analyst pass (mode:'llm'): reads the stored snapshot,
        // cite-or-drop gated. Degrades to deterministic findings on analyst failure
        // unless explicitly requested — the run is never lost to an upstream outage.
        let llmFindings = []
        let analystError = null
        if (input.mode === 'llm') {
          try {
            const { rows: snaps } = await c.query(
              'SELECT body FROM discovery_snapshots WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1',
              [run.id],
            )
            const out = await analyst.analyze({ extracted: run.extracted || {}, snapshot: snaps[0]?.body || '' })
            llmFindings = out.findings
          } catch (err) {
            analystError = err.message || 'analyst failed'
          }
        }
        if (analystError && llmFindings.length === 0) {
          const e = new Error(`analyst failed: ${analystError}`); e.status = 502; throw e
        }

        // 2. deterministic extraction + LLM findings merged (dedup by type+excerpt)
        const { findings, pain_cues } = analyzeExtracted(run.extracted || {})
        const detEnriched = findings.map((f) => ({ ...f, confidence: findingConfidence(f, run.extracted || {}) }))
        const seen = new Set(detEnriched.map((f) => `${f.event_type}:${f.excerpt.slice(0, 60)}`))
        const enriched = detEnriched
        for (const f of llmFindings) {
          const key = `${f.event_type}:${f.excerpt.slice(0, 60)}`
          if (seen.has(key)) continue
          seen.add(key)
          enriched.push(f)
        }

        // 3. signal row (even when findings are empty: "crawled, nothing matched" is a fact)
        const summary = enriched.length
          ? enriched.map((f) => `${f.label}: ${f.excerpt}`).join(' | ').slice(0, 2000)
          : `No classified signals on ${(run.final_url || run.requested_url).slice(0, 200)}`
        const eventType = enriched.length ? enriched[0].event_type : 'none'
        const orgId = input.organisation_id ?? run.organisation_id ?? null
        const { rows: sig } = await c.query(
          `INSERT INTO signals (tenant_id, event_type, occurred_at, summary, source_ids, claim_refs, affected_org_ids, created_by)
           VALUES ($1,$2,now(),$3,$4,'{}',$5,$6) RETURNING *`,
          [req.tenantId, eventType, summary, [sourceId], orgId ? [orgId] : [], req.user.id],
        )

        // 4. low-confidence findings become research tasks (human verifies, machine never assumes)
        const tasks = []
        for (const f of enriched) {
          if (f.confidence >= 0.7) continue
          const { rows: t } = await c.query(
            `INSERT INTO research_tasks (tenant_id, organisation_id, reason, created_by)
             VALUES ($1,$2,$3,$4) RETURNING id, reason`,
            [req.tenantId, orgId,
             `Verify ${f.label.toLowerCase()} (confidence ${f.confidence}): "${f.excerpt.slice(0, 140)}"`,
             req.user.id],
          )
          tasks.push(t[0])
        }
        if (pain_cues.length && orgId) {
          const { rows: t } = await c.query(
            `INSERT INTO research_tasks (tenant_id, organisation_id, reason, created_by)
             VALUES ($1,$2,$3,$4) RETURNING id, reason`,
            [req.tenantId, orgId, `Pain cues on page: ${pain_cues.join(', ')} — verify before citing`, req.user.id],
          )
          tasks.push(t[0])
        }

        await audit(c, req.tenantId, req.user.id, 'discovery.analyze', 'discovery_run', run.id)
        await trackEvent(c, req.tenantId, 'discovery.analyze', {
          actorUserId: req.user.id,
          objectId: run.id,
          metadata: { signal_id: sig[0].id, findings: enriched.length, research_tasks: tasks.length },
        })
        return { signal: sig[0], findings: enriched, pain_cues, source_id: sourceId, research_tasks: tasks }
      })
      res.status(201).json(out)
    } catch (e) { next(e) }
  })

  // GET /signals/:id — signal with resolved sources + affected org names + promoted claims.
  router.get('/signals/:id', async (req, res, next) => {
    try {
      const data = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query('SELECT * FROM signals WHERE id = $1', [req.params.id])
        const signal = rows[0]
        if (!signal) { const e = new Error('signal not found'); e.status = 404; throw e }
        const { rows: srcs } = await c.query(
          `SELECT id, kind, url, publisher, source_type, published_at, excerpt, observed_at
             FROM sources WHERE id = ANY($1::uuid[])`, [signal.source_ids])
        const { rows: orgs } = await c.query(
          `SELECT id, canonical_name FROM organisations WHERE id = ANY($1::uuid[])`,
          [signal.affected_org_ids])
        const { rows: claims } = await c.query(
          `SELECT id, subject_type, subject_id, predicate, value, assertion_type, evidence_source_ids, created_at
             FROM claims WHERE id = ANY($1::uuid[])`, [signal.claim_refs])
        return { signal, sources: srcs, orgs, claims }
      })
      res.json(data)
    } catch (e) { next(e) }
  })

  // POST /signals/:id/promote — turn one finding into a claim on an affected org.
  // Body: {predicate, value, organisation_id}. assertion_type='sourced_fact' (signal has sources),
  // evidence_source_ids = the signal's sources. Refuses claims without a subject org.
  const promoteSchema = z.object({
    predicate: z.string().min(1).max(120),
    value: z.union([z.string().max(2000), z.number(), z.boolean()]),
    organisation_id: z.string().uuid(),
  })
  router.post('/signals/:id/promote', requireRole('admin', 'analyst'), jsonBody, async (req, res, next) => {
    try {
      const input = promoteSchema.parse(req.body ?? {})
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query('SELECT * FROM signals WHERE id = $1', [req.params.id])
        const signal = rows[0]
        if (!signal) { const e = new Error('signal not found'); e.status = 404; throw e }
        if (!signal.source_ids.length) {
          const e = new Error('signal has no evidence sources; promote refused (cite-or-hypothesis law)')
          e.status = 409; throw e
        }
        const { rows: claim } = await c.query(
          `INSERT INTO claims (tenant_id, subject_type, subject_id, predicate, value, assertion_type,
                               evidence_source_ids, rationale, created_by)
           VALUES ($1,'organisation',$2,$3,$4::jsonb,'sourced_fact',$5,$6,$7) RETURNING *`,
          [req.tenantId, input.organisation_id, input.predicate,
           JSON.stringify(input.value), signal.source_ids,
           `Promoted from signal ${signal.id}: ${signal.summary.slice(0, 300)}`, req.user.id],
        )
        await c.query(
          `UPDATE signals SET claim_refs = claim_refs || $1::uuid[] WHERE id = $2`,
          [[claim[0].id], signal.id],
        )
        await audit(c, req.tenantId, req.user.id, 'signal.promote', 'claim', claim[0].id)
        await trackEvent(c, req.tenantId, 'signal.promoted', {
          actorUserId: req.user.id,
          objectId: claim[0].id,
          metadata: { signal_id: signal.id, predicate: input.predicate },
        })
        return { claim: claim[0] }
      })
      res.status(201).json(out)
    } catch (e) { next(e) }
  })

  return router
}

function hostOf(u) {
  try { return new URL(u).hostname } catch { return null }
}
