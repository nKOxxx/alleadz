// server/test/analyst.test.js — the LLM analyst: cite-or-drop gates (findings + rankings),
// mode:'llm' route contract, /leads/rank scoring chain, using the house harness
// (scratch DB, LLM upstream stubbed via fetchImpl).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'
import { gateFindings, gateRanking } from '../src/lib/analyst.js'
import { extractAllowed } from '../src/lib/discovery.js'

// ---- unit: the cite-or-drop law -------------------------------------------
describe('gateFindings', () => {
  const hay = 'Nimbus Metrics raised $8M Series A led by Northlane. Analysts still stitch spreadsheets.'
  it('keeps findings whose quote is verbatim', () => {
    const out = gateFindings([
      { event_type: 'funding', summary: 'Raised $8M', quote: 'raised $8M Series A led by Northlane', confidence: 0.9 },
    ], hay)
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('llm_analyst')
    expect(out[0].strength).toBe('strong')
  })
  it('drops hallucinated quotes (not verbatim in the page)', () => {
    const out = gateFindings([
      { event_type: 'funding', summary: 'Made up', quote: 'raised $500B in Lagos', confidence: 0.99 },
    ], hay)
    expect(out).toHaveLength(0)
  })
  it('rejects unknown event types and non-string junk', () => {
    expect(gateFindings([{ event_type: 'ipo', quote: 'stitch spreadsheets every week', confidence: 0.9 }], hay)).toHaveLength(0)
    expect(gateFindings([null, 'x', 42], hay)).toHaveLength(0)
    expect(gateFindings(undefined, hay)).toHaveLength(0)
  })
  it('clamps confidence and maps strength bands', () => {
    const out = gateFindings([
      { event_type: 'pain', quote: 'stitch spreadsheets', confidence: 5 },
      { event_type: 'hiring', quote: 'stitch spreadsheets', confidence: -1 },
    ], hay)
    expect(out[0].confidence).toBe(1)
    expect(out[0].strength).toBe('strong')
    expect(out[1].confidence).toBe(0)
    expect(out[1].strength).toBe('weak')
  })
})

// ---- integration: analyze mode:llm on the house harness -------------------
describe('analyze mode:llm', () => {
  let ctx

  // Page the deterministic pass partially understands; the LLM pass adds the
  // pain finding; the hallucinated finding must not survive the gate.
  const PAGE = `<!doctype html><html><head><title>Nimbus Metrics — About</title></head>
<body><p>Nimbus Metrics raised $8M Series A led by Northlane to scale agent observability.</p>
<p>Our analysts still stitch together spreadsheets and manual exports every single week.</p>
<p>Founded 2021 in Helsinki. Offices in Berlin.</p></body></html>`

  const LLM_JSON = JSON.stringify({
    findings: [
      { event_type: 'funding', summary: 'Raised $8M Series A (Northlane)', quote: 'raised $8M Series A led by Northlane', confidence: 0.9 },
      { event_type: 'pain', summary: 'Manual spreadsheet workflow admitted on page', quote: 'stitch together spreadsheets and manual exports every single week', confidence: 0.6 },
      { event_type: 'funding', summary: 'HALLUCINATION ATTEMPT', quote: 'raised $500B in Lagos', confidence: 0.99 },
    ],
  })

  // analyst upstream stub: chat/completions returns canned JSON
  const analystFetch = async (url) => {
    if (String(url).includes('chat/completions')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: LLM_JSON } }] }) }
    }
    throw new Error('unexpected fetch in analyst test: ' + url)
  }

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-not-real' // installs the analyst; upstream is stubbed via fetchImpl
    ctx = { db: await createScratchDb() }
    ctx.app = ctx.db.createApp({ rateLimits: false, fetchImpl: analystFetch })
    ctx.server = ctx.app.listen(0)
    ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
    ctx.A = await registerUser(ctx.base, 'analyst@p7.test', 'Analyst')
  })

  afterAll(async () => {
    delete process.env.DEEPSEEK_API_KEY
    ctx?.server?.close()
    await ctx?.db?.cleanup()
  })

  async function insertRun(url, html) {
    const extracted = extractAllowed(html)
    const { rows } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO discovery_runs (tenant_id, requested_url, final_url, http_status, content_hash, bytes, extracted, status, run_by)
       VALUES ($1,$2,$2,200,'testhash',123,$3,'ok',$4) RETURNING id`,
      [ctx.A.tenantId, url, JSON.stringify(extracted), ctx.A.userId])
    await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO discovery_snapshots (tenant_id, run_id, content_hash, body) VALUES ($1,$2,'testhash',$3)`,
      [ctx.A.tenantId, rows[0].id, html])
    return rows[0].id
  }

  it('503s when mode:llm requested but no analyst is configured', async () => {
    delete process.env.DEEPSEEK_API_KEY // self-contained: no key -> no analyst installed
    const db2 = await createScratchDb()
    const app2 = db2.createApp({ rateLimits: false }) // no key -> no analyst installed
    const s2 = app2.listen(0)
    const base2 = `http://127.0.0.1:${s2.address().port}`
    const u = await registerUser(base2, 'nokey@p7.test', 'NoKey')
    const res = await api(base2, { method: 'POST', path: '/discovery/analyze', token: u.token,
      tenantId: u.tenantId, body: { run_id: '00000000-0000-4000-8000-000000000000', mode: 'llm' } })
    expect(res.status).toBe(503)
    s2.close()
    await db2.cleanup()
    process.env.DEEPSEEK_API_KEY = 'test-key-not-real' // restore for the sibling tests
  })

  it('merges LLM findings into the signal, drops the hallucinated quote', async () => {
    const runId = await insertRun('https://nimbus.example/about', PAGE)

    const an = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId, mode: 'llm' } })
    console.log('DEBUG analyze ->', an.status, JSON.stringify(an.json).slice(0, 500))
    expect(an.status).toBe(201)

    const types = an.json.findings.map((f) => f.event_type)
    expect(types).toContain('pain') // LLM-only: regex pass has no pain TYPE
    const origins = an.json.findings.map((f) => f.origin || 'deterministic')
    expect(origins).toContain('llm_analyst')
    // the law, end to end: the hallucinated quote appears NOWHERE
    expect(JSON.stringify(an.json)).not.toContain('Lagos')

    // weak LLM finding (0.6 < 0.7) opened a research task, exactly like weak regex findings
    expect(an.json.research_tasks.some((t) => /spreadsheet/i.test(t.reason))).toBe(true)
  })

  it('deterministic mode (no mode field) behaves exactly as before', async () => {
    const runId = await insertRun('https://calm.example/', `<!doctype html><html><head><title>Calm</title></head><body><p>Nothing here.</p></body></html>`)
    const an = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    expect(an.status).toBe(201)
    expect(an.json.findings).toHaveLength(0)
    expect(an.json.signal.event_type).toBe('none')
  })
})

// ---- rank: gate + scoring chain --------------------------------------------
describe('gateRanking', () => {
  const dossier = { id: '11111111-1111-4111-8111-111111111111', name: 'Nimbus' }
  const hay = 'ORG 11111111-1111-4111-8111-111111111111 (Nimbus)\nCLAIM [sourced_fact] pain: analysts stitch spreadsheets every single week'
  it('keeps a ranking whose why is verbatim in the dossier', () => {
    const out = gateRanking({
      organisation_id: dossier.id, why: 'analysts stitch spreadsheets every single week',
      ratings: { fit: { rating: 4, rationale: 'video-heavy team' }, trigger: { rating: 'unknown' } },
    }, dossier, hay)
    expect(out).not.toBeNull()
    expect(out.ratings.fit.rating).toBe(4)
    expect(out.ratings.trigger.rating).toBe('unknown')
    expect(out.origin).toBe('llm_analyst')
  })
  it('drops hallucinated whys, id mismatches, and junk shapes', () => {
    expect(gateRanking({ organisation_id: dossier.id, why: 'they said they will buy $2M next quarter', ratings: {} }, dossier, hay)).toBeNull()
    expect(gateRanking({ organisation_id: '22222222-2222-4222-8222-222222222222', why: 'analysts stitch spreadsheets', ratings: {} }, dossier, hay)).toBeNull()
    expect(gateRanking(null, dossier, hay)).toBeNull()
    expect(gateRanking({ organisation_id: dossier.id, why: 'short', ratings: {} }, dossier, hay)).toBeNull()
  })
  it('clamps ratings and coerces non-numeric to unknown', () => {
    const out = gateRanking({
      organisation_id: dossier.id, why: 'analysts stitch spreadsheets',
      ratings: { fit: { rating: 9, rationale: 'x' }, trigger: { rating: 'high', rationale: 'x' }, timing: { rating: -3, rationale: 'x' } },
    }, dossier, hay)
    expect(out.ratings.fit.rating).toBe(4)
    expect(out.ratings.trigger.rating).toBe('unknown')
    expect(out.ratings.timing.rating).toBe(0)
  })
})

describe('POST /leads/rank', () => {
  let ctx

  const analystFetch = async (url, opts) => {
    if (String(url).includes('chat/completions')) {
      // respond with rankings derived from the request body so citations are real
      const body = JSON.parse(opts.body)
      const user = body.messages.find((m) => m.role === 'user').content
      const ids = [...user.matchAll(/ORG ([0-9a-f-]{36}) \(([^)]+)\)/g)]
      return { ok: true, status: 200, json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          orgs: ids.map(([_, id, name]) => ({
            organisation_id: id,
            // verbatim substring of a dossier line — for the "bad" org this line
            // does not exist, so the gate must drop it (cite-or-drop, exercised)
            why: 'video-first team drowning in manual clipping',
            ratings: {
              fit: { rating: 4, rationale: 'video-first team' },
              trigger: { rating: 3, rationale: 'hiring clip editors' },
              timing: { rating: 'unknown' },
              budget: { rating: 2, rationale: 'seed stage' },
              access: { rating: 'unknown' },
            },
          })),
        }) } }],
      }) }
    }
    throw new Error('unexpected fetch in analyst test: ' + url)
  }

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key-not-real'
    ctx = { db: await createScratchDb() }
    ctx.app = ctx.db.createApp({ rateLimits: false, fetchImpl: analystFetch })
    ctx.server = ctx.app.listen(0)
    ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
    ctx.A = await registerUser(ctx.base, 'ranker@p7.test', 'Ranker')
  })

  afterAll(async () => {
    delete process.env.DEEPSEEK_API_KEY
    ctx?.server?.close()
    await ctx?.db?.cleanup()
  })

  it('ranks orgs brain-rated spine-scored, persists inference claims, drops bad whys', async () => {
    // two orgs; the SECOND gets a dossier whose content will NOT match the stub's why
    // (stub emits the same why for both) -> only org 1 survives the gate
    const mk = async (name) => (await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO organisations (tenant_id, canonical_name, entity_type) VALUES ($1,$2,'buyer') RETURNING id`,
      [ctx.A.tenantId, name])).rows[0].id
    const good = await mk('ClipForge Media')
    const bad = await mk('DeskButton Ltd')

    await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO claims (tenant_id, subject_type, subject_id, predicate, value, assertion_type, rationale, created_by)
       VALUES ($1,'organisation',$2,'pain_point',$3::jsonb,'sourced_fact','seen on careers page',$4)`,
      [ctx.A.tenantId, good, JSON.stringify('video-first team drowning in manual clipping'), ctx.A.userId])
    await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO claims (tenant_id, subject_type, subject_id, predicate, value, assertion_type, rationale, created_by)
       VALUES ($1,'organisation',$2,'product',$3::jsonb,'sourced_fact','homepage',$4)`,
      [ctx.A.tenantId, bad, JSON.stringify('desk buttons'), ctx.A.userId])

    const res = await api(ctx.base, { method: 'POST', path: '/leads/rank', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: {} })
    expect(res.status).toBe(201)

    // good org: brain rated fit4/trigger3/budget2 -> spine math (35 + 18.75 + 7.5) = 61.25, coverage 0.75
    const g = res.json.ranked.find((r) => r.organisation_id === good)
    expect(g).toBeTruthy()
    expect(g.priority).toBeCloseTo(61.25, 2)
    expect(g.coverage).toBeCloseTo(0.75, 2)
    expect(g.why).toBe('video-first team drowning in manual clipping')
    expect(g.model).toBeTruthy()

    // bad org: why not verbatim in its dossier -> dropped by the gate
    expect(res.json.ranked.find((r) => r.organisation_id === bad)).toBeUndefined()
    expect(res.json.ranked_count).toBe(1)
    expect(res.json.input_count).toBe(2)

    // persistence: inference claim with non-empty rationale (schema-enforced)
    const { rows: cl } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT predicate, assertion_type, rationale, value FROM claims WHERE id = $1`, [g.claim_id])
    expect(cl[0].predicate).toBe('lead_ranking')
    expect(cl[0].assertion_type).toBe('inference')
    expect(cl[0].rationale.length).toBeGreaterThan(0)
    expect(cl[0].value.priority).toBeCloseTo(61.25, 2)
  })

  it('503s when no analyst is configured', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const db2 = await createScratchDb()
    const app2 = db2.createApp({ rateLimits: false })
    const s2 = app2.listen(0)
    const base2 = `http://127.0.0.1:${s2.address().port}`
    const u = await registerUser(base2, 'norank@p7.test', 'NoRank')
    const res = await api(base2, { method: 'POST', path: '/leads/rank', token: u.token,
      tenantId: u.tenantId, body: {} })
    expect(res.status).toBe(503)
    s2.close()
    await db2.cleanup()
    process.env.DEEPSEEK_API_KEY = 'test-key-not-real'
  })
})

