// server/src/routes/discovery.js — P5: bounded fetch route (caps enforced),
// snapshot retention, allowlisted extraction only.
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'
import { boundedFetch, extractAllowed, DISCOVERY_LIMITS } from '../lib/discovery.js'

const runSchema = z.object({
  organisation_id: z.string().uuid().nullable().optional(),
  urls: z.array(z.string().url()).min(1).max(DISCOVERY_LIMITS.maxPerRun),
})

export function createDiscoveryRouter({ pool, fetchImpl } = {}) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))

  router.post('/discovery/run', requireRole('admin', 'analyst'), express.json({ limit: '100kb' }), async (req, res, next) => {
    try {
      const input = runSchema.parse(req.body)
      const results = []
      for (const url of input.urls.slice(0, DISCOVERY_LIMITS.maxPerRun)) {
        try {
          const out = await boundedFetch(url, { fetchImpl: fetchImpl || globalThis.fetch })
          const extracted = extractAllowed(out.snapshot)
          const saved = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
            const { rows } = await c.query(
              `INSERT INTO discovery_runs (tenant_id, organisation_id, requested_url, final_url, http_status, content_hash, bytes, extracted, status, run_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ok',$9) RETURNING id`,
              [req.tenantId, input.organisation_id ?? null, url, out.finalUrl, out.status, out.contentHash, out.bytes,
               JSON.stringify(extracted), req.user.id],
            )
            await c.query(
              `INSERT INTO discovery_snapshots (tenant_id, run_id, content_hash, body) VALUES ($1,$2,$3,$4)`,
              [req.tenantId, rows[0].id, out.contentHash, out.snapshot],
            )
            return rows[0].id
          })
          results.push({ url, run_id: saved, status: 'ok', http_status: out.status, extracted })
        } catch (err) {
          const blocked = /Blocked host|Only http|Invalid URL/.test(err.message)
          await withTenant(pool, req.tenantId, req.user.id, async (c) => {
            await c.query(
              `INSERT INTO discovery_runs (tenant_id, organisation_id, requested_url, status, error, run_by)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [req.tenantId, input.organisation_id ?? null, url, blocked ? 'blocked' : 'failed', err.message, req.user.id],
            )
          })
          results.push({ url, status: blocked ? 'blocked' : 'failed', error: err.message })
        }
      }
      res.json({ results })
    } catch (e) { next(e) }
  })

  router.get('/discovery/runs', async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`SELECT id, organisation_id, requested_url, final_url, http_status, content_hash, bytes,
                        extracted, status, error, created_at
                 FROM discovery_runs ORDER BY created_at DESC LIMIT 100`),
      )
      res.json({ runs: rows.rows })
    } catch (e) { next(e) }
  })

  return router
}
