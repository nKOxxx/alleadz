// server/test/portfolio.test.js — P6 gates A14 (packs by config) / A15 (envelope allowlist)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api } from './helpers.js'

let ctx

beforeAll(async () => {
  ctx = { db: await createScratchDb() }
  ctx.app = ctx.db.createApp({ rateLimits: false })
  ctx.server = ctx.app.listen(0)
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  ctx.A = await registerUser(ctx.base, 'a@p6.test', 'P6')

  const offerOrg = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token, tenantId: ctx.A.tenantId,
    body: { canonical_name: 'PackOffer Co', entity_type: 'provider' } })
  const twin = await api(ctx.base, { method: 'POST', path: '/twins', token: ctx.A.token, tenantId: ctx.A.tenantId,
    body: { organisation_id: offerOrg.json.id, offering: true,
      version: { mandate: 'originate GPU compute and data centre capacity deals', permitted_markets: [], excluded_markets: [],
        capabilities: [
          { name: 'GPU compute brokerage', status: 'reviewed' },
          { name: 'GPU hardware supply', status: 'reviewed' },
          { name: 'Data centre capacity', status: 'reviewed' },
        ], status: 'active' } } })
  ctx.twinId = twin.json.twin?.id || twin.json.id

  // build one qualified opportunity per sector via the real chain
  for (const sector of ['gpu_rental', 'gpu_hardware', 'ai_colocation']) {
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { canonical_name: `Buyer ${sector}`, entity_type: 'buyer', country: 'United Arab Emirates' } })
    const opp = await api(ctx.base, { method: 'POST', path: '/opportunities', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { offering_twin_id: ctx.twinId, target_org_id: org.json.id, sector_type: sector } })
    const ratings = {
      fit: { rating: 4, rationale: 'r', source_ids: [] },
      trigger: { rating: 3, rationale: 'r', source_ids: [] },
      timing: { rating: 3, rationale: 'r', source_ids: [] },
      budget: { rating: 2, rationale: 'r', source_ids: [] },
      access: { rating: 3, rationale: 'r', source_ids: [] },
    }
    // seed claims so all hard checks pass (mandate + geography + procurement)
    await api(ctx.base, { method: 'POST', path: '/claims', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { subject_type: 'organisation', subject_id: org.json.id, predicate: 'mandate_summary',
        value: 'expanding GPU compute and data centre capacity', assertion_type: 'user_claim' } })
    await api(ctx.base, { method: 'POST', path: '/claims', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { subject_type: 'organisation', subject_id: org.json.id, predicate: 'procurement_eligible',
        value: true, assertion_type: 'user_claim' } })
    await api(ctx.base, { method: 'POST', path: '/theses', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { opportunity_id: opp.json.opportunity.id, ratings } })
    for (const st of ['researching', 'thesis_ready']) {
      await api(ctx.base, { method: 'POST', path: `/opportunities/${opp.json.opportunity.id}/transitions`,
        token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: st } })
    }
    // human_reviewed role gate: admin ok
    await api(ctx.base, { method: 'POST', path: `/opportunities/${opp.json.opportunity.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'human_reviewed', reason: 'alpha demo' } })
    await api(ctx.base, { method: 'POST', path: `/opportunities/${opp.json.opportunity.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'qualifying' } })
    const q = await api(ctx.base, { method: 'POST', path: `/opportunities/${opp.json.opportunity.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'qualified' } })
    expect(q.status).toBe(200) // all hard checks pass: evidenced caps + UAE + no disqualifiers
    ctx[sector] = opp.json.opportunity.id
  }
})

afterAll(async () => {
  ctx?.server?.close()
  await ctx?.db?.cleanup()
})

describe('A14: sector packs are configuration', () => {
  it('packs endpoint lists all sectors with the right value models', async () => {
    const res = await api(ctx.base, { path: '/packs', token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(res.status).toBe(200)
    expect(res.json.packs.gpu_rental.value_model).toBe('rental')
    expect(res.json.packs.ai_colocation.value_model).toBe('colocation')
    expect(res.json.packs.gpu_hardware.value_model).toBe('hardware')
    expect(res.json.packs.gov_data_infra.label).toMatch(/Government/)
  })

  it('portfolio groups opportunities by sector + stage', async () => {
    const res = await api(ctx.base, { path: '/portfolio', token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(res.status).toBe(200)
    const qualified = res.json.portfolio.filter((r) => r.stage === 'qualified')
    expect(qualified.length).toBe(3)
    expect(qualified.map((r) => r.sector_type).sort()).toEqual(['ai_colocation', 'gpu_hardware', 'gpu_rental'])
    expect(Number(qualified[0].avg_priority)).toBeGreaterThan(0)
  })
})

describe('A15: handoff envelope (frozen contract)', () => {
  it('export produces schema_version 1 envelope + allowlisted payload only', async () => {
    const res = await api(ctx.base, { method: 'POST', path: '/handoffs/export', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { opportunity_id: ctx.gpu_rental, event_type: 'opportunity.handoff',
        recipient: 'partner-desk@example.com', disclosure_scope: ['company_name', 'scores'] } })
    expect(res.status).toBe(201)
    expect(res.json.envelope.schema_version).toBe('1')
    expect(res.json.envelope.correlation_id).toBe(`opp:${ctx.gpu_rental}`)
    expect(Object.keys(res.json.payload).every((k) =>
      ['target_name', 'sector_type', 'stage', 'priority', 'coverage', 'confidence', 'summary'].includes(k))).toBe(true)
    expect(res.json.envelope.payload_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('non-qualified opportunity cannot be handed off', async () => {
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { canonical_name: 'Early Buyer', entity_type: 'buyer' } })
    const opp = await api(ctx.base, { method: 'POST', path: '/opportunities', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { offering_twin_id: ctx.twinId, target_org_id: org.json.id, sector_type: 'gpu_rental' } })
    const res = await api(ctx.base, { method: 'POST', path: '/handoffs/export', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { opportunity_id: opp.json.opportunity.id, event_type: 'opportunity.handoff',
        recipient: 'x@example.com', disclosure_scope: ['company_name'] } })
    expect(res.status).toBe(409)
  })
})
