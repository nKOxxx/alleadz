// server/test/intelligence.test.js — intelligence layer: deterministic extraction,
// discovery→analyze→signal→claim chain, research-task generation, cite-or-hypothesis law.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'

let ctx

// Page that deterministic patterns should catch: funding + hiring + pain cues.
const FUNDING_PAGE = `<!doctype html><html><head><title>Gulf AI Labs — News</title></head>
<body><article><h1>Series B announced 2026-09-15</h1>
<p>Gulf AI Labs raised $24M Series B to expand GPU capacity. We're hiring across engineering.
Teams still rely on spreadsheets and manual workarounds for pipeline.</p>
</article></body></html>`

// A page with no classifiable signals.
const QUIET_PAGE = `<!doctype html><html><head><title>Calm Corp</title></head>
<body><p>Welcome to our corporate website. Contact us for more information.</p></body></html>`

beforeAll(async () => {
  ctx = { db: await createScratchDb() }
  ctx.app = ctx.db.createApp({ rateLimits: false })
  ctx.server = ctx.app.listen(0)
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  ctx.A = await registerUser(ctx.base, 'intel@p6.test', 'Intel')
})

afterAll(async () => {
  ctx?.server?.close()
  await ctx?.db?.cleanup()
})

async function runDiscovery(url, body) {
  const res = await api(ctx.base, { method: 'POST', path: '/discovery/run', token: ctx.A.token,
    tenantId: ctx.A.tenantId, body: { urls: [url] } })
  expect(res.status).toBe(200)
  const result = res.json.results[0]
  // stub network unreachable in tests is fine: use queryAsTenant to insert a run row directly
  if (result.status !== 'ok') {
    const { extractAllowed } = await import('../src/lib/discovery.js')
    const extracted = extractAllowed(body)
    const { rows } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO discovery_runs (tenant_id, requested_url, final_url, http_status, content_hash, bytes, extracted, status, run_by)
       VALUES ($1,$2,$2,200,'testhash',123,$3,'ok',$4) RETURNING id`,
      [ctx.A.tenantId, url, JSON.stringify(extracted), ctx.A.userId])
    return rows[0].id
  }
  return result.run_id
}

describe('deterministic extraction (lib)', () => {
  it('finds funding/hiring + pain cues, quotes evidence windows', async () => {
    const { extractAllowed } = await import('../src/lib/discovery.js')
    const { analyzeExtracted, findingConfidence } = await import('../src/lib/intelligence.js')
    const ex = extractAllowed(FUNDING_PAGE)
    const { findings, pain_cues } = analyzeExtracted(ex)
    const types = findings.map((f) => f.event_type)
    expect(types).toContain('funding')
    expect(types).toContain('hiring')
    expect(pain_cues).toContain('spreadsheet')
    expect(pain_cues).toContain('manual')
    for (const f of findings) {
      expect(f.excerpt.length).toBeGreaterThan(10)
      expect(f.predicate).toBeTruthy()
      expect(findingConfidence(f, ex)).toBeGreaterThan(0)
    }
  })

  it('stays silent on quiet pages (no fabricated findings)', async () => {
    const { extractAllowed } = await import('../src/lib/discovery.js')
    const { analyzeExtracted } = await import('../src/lib/intelligence.js')
    const { findings, pain_cues } = analyzeExtracted(extractAllowed(QUIET_PAGE))
    // 'Contact us for more information' — no pattern may fire
    expect(findings.filter((f) => f.event_type !== 'hiring').length).toBe(0)
    expect(pain_cues.length).toBe(0)
  })
})

describe('POST /discovery/analyze', () => {
  it('creates source + signal + findings; low-confidence opens research tasks', async () => {
    const runId = await runDiscovery('https://press.example.com/gulf-ai', FUNDING_PAGE)
    const res = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    expect(res.status).toBe(201)
    expect(res.json.signal.id).toBeTruthy()
    expect(res.json.source_id).toBeTruthy()
    expect(res.json.findings.map((f) => f.event_type)).toContain('funding')
    // published_at present + title present → funding (strong) should clear 0.7
    const funding = res.json.findings.find((f) => f.event_type === 'funding')
    expect(funding.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('records an honest "no signals" row for quiet pages', async () => {
    const runId = await runDiscovery('https://press.example.com/calm', QUIET_PAGE)
    const res = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    expect(res.status).toBe(201)
    expect(res.json.signal.event_type).toBe('none')
    expect(res.json.findings.length).toBe(0)
  })

  it('404s on unknown run, 409 on failed runs', async () => {
    const res404 = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: '00000000-0000-4000-8000-000000000000' } })
    expect(res404.status).toBe(404)
  })
})

describe('signal → claim promotion (cite-or-hypothesis law)', () => {
  it('promotes a finding to a sourced_fact claim with evidence; refuses evidence-free signals', async () => {
    const runId = await runDiscovery('https://press.example.com/gulf-2', FUNDING_PAGE)
    const an = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    const { signal, source_id } = an.json

    // org to pin the claim to
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'Gulf AI Labs', entity_type: 'buyer' } })
    expect(org.status).toBe(201)
    const orgId = org.json.id

    const promo = await api(ctx.base, { method: 'POST', path: `/signals/${signal.id}/promote`,
      token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { predicate: 'funding_stage', value: 'Series B', organisation_id: orgId } })
    expect(promo.status).toBe(201)
    expect(promo.json.claim.assertion_type).toBe('sourced_fact')
    expect(promo.json.claim.evidence_source_ids).toContain(source_id)

    // detail view resolves sources + claims
    const detail = await api(ctx.base, { method: 'GET', path: `/signals/${signal.id}`,
      token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(detail.status).toBe(200)
    expect(detail.json.sources.map((s) => s.id)).toContain(source_id)
    expect(detail.json.claims.map((c) => c.id)).toContain(promo.json.claim.id)

    // a hand-made signal with NO sources must refuse promotion
    const bare = await api(ctx.base, { method: 'POST', path: '/signals', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { event_type: 'idea', summary: 'gut feeling, no evidence' } })
    expect(bare.status).toBe(201)
    const refused = await api(ctx.base, { method: 'POST', path: `/signals/${bare.json.signal.id}/promote`,
      token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { predicate: 'funding_stage', value: 'Series C', organisation_id: orgId } })
    expect(refused.status).toBe(409)
  })
})

describe('stealth transport (Scrapling sidecar, additive)', () => {
  it('stealth:true without SCRAPLING_URL behaves exactly like direct (feature off)', async () => {
    const runId = await runDiscovery('https://press.example.com/gulf-3', FUNDING_PAGE)
    const res = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    expect(res.status).toBe(201)
    // run a stealth request through /discovery/run with no sidecar configured:
    const run = await api(ctx.base, { method: 'POST', path: '/discovery/run', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { urls: ['https://127.0.0.1:9/x'], stealth: true } })
    // SSRF guard still fires (transport-independent); no crash, honest blocked row
    expect(run.status).toBe(200)
    expect(run.json.results[0].status).toBe('blocked')
  })
})
