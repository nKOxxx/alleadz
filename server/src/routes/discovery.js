// server/src/routes/discovery.js — P5: bounded fetch route (caps enforced),
// snapshot retention, allowlisted extraction only.
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'
import { boundedFetch, extractAllowed, DISCOVERY_LIMITS } from '../lib/discovery.js'
import { trackEvent } from '../lib/events.js'

const runSchema = z.object({
  organisation_id: z.string().uuid().nullable().optional(),
  urls: z.array(z.string().url()).min(1).max(DISCOVERY_LIMITS.maxPerRun),
  // ADDITIVE: optional stealth transport for bot-challenged pages. When the
  // Scrapling sidecar is configured (SCRAPLING_URL) and this is true, each URL
  // tries stealth first, then falls back to plain boundedFetch on any error.
  stealth: z.boolean().nullable().optional(),
})

// Optional stealth transport (Scrapling sidecar). Same result shape as
// boundedFetch: {status, finalUrl, bytes, contentHash, snapshot}. Absent env
// var => feature off, zero behavior change (contract additive).
async function stealthFetch(sidecarUrl, rawUrl) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(`${sidecarUrl}/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: rawUrl }),
      signal: ctrl.signal,
    })
    const body = await res.json()
    if (!res.ok) {
      const e = new Error(body?.detail || `sidecar ${res.status}`)
      e.status = res.status
      throw e
    }
    return { status: body.status, finalUrl: body.finalUrl, bytes: body.bytes,
             contentHash: body.contentHash, snapshot: body.snapshot }
  } finally {
    clearTimeout(timer)
  }
}

export function createDiscoveryRouter({ pool, fetchImpl } = {}) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))

  router.post('/discovery/run', requireRole('admin', 'analyst'), express.json({ limit: '100kb' }), async (req, res, next) => {
    try {
      const input = runSchema.parse(req.body)
      const sidecar = process.env.SCRAPLING_URL || null
      const results = []
      for (const url of input.urls.slice(0, DISCOVERY_LIMITS.maxPerRun)) {
        try {
          let out = null
          let via = 'direct'
          if (input.stealth && sidecar) {
            try {
              out = await stealthFetch(sidecar, url)
              via = 'stealth'
            } catch (stealthErr) {
              // fall through to direct transport; record the stealth failure reason
              out = null
              via = `stealth-failed: ${String(stealthErr.message).slice(0, 120)}`
            }
          }
          if (!out) {
            out = await boundedFetch(url, { fetchImpl: fetchImpl || globalThis.fetch })
            via = via === 'direct' ? 'direct' : `${via};fell-back-to-direct`
          }
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
            await trackEvent(c, req.tenantId, 'discovery.run', {
              actorUserId: req.user.id,
              objectId: rows[0].id,
              metadata: { url, status: 'ok', via, http_status: out.status },
            })
            return rows[0].id
          })
          results.push({ url, run_id: saved, status: 'ok', http_status: out.status, via, extracted })
        } catch (err) {
          const blocked = /Blocked host|Only http|Invalid URL/.test(err.message)
          await withTenant(pool, req.tenantId, req.user.id, async (c) => {
            await c.query(
              `INSERT INTO discovery_runs (tenant_id, organisation_id, requested_url, status, error, run_by)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [req.tenantId, input.organisation_id ?? null, url, blocked ? 'blocked' : 'failed', err.message, req.user.id],
            )
            await trackEvent(c, req.tenantId, 'discovery.run', {
              actorUserId: req.user.id,
              metadata: { url, status: blocked ? 'blocked' : 'failed' },
            })
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
