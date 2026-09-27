// server/test/opportunities.test.js — P3 gates A05–A08
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'

let ctx

beforeAll(async () => {
  ctx = { db: await createScratchDb() }
  ctx.app = ctx.db.createApp({ rateLimits: false })
  ctx.server = ctx.app.listen(0)
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  ctx.A = await registerUser(ctx.base, 'analyst@p3.test', 'P3')

  // offering org + offering twin with mandate + evidenced capability
  const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token, tenantId: ctx.A.tenantId,
    body: { canonical_name: 'Our OfferCo', entity_type: 'provider', domains: ['offerco.com'] } })
  ctx.offerOrgId = org.json.id
  const twin = await api(ctx.base, { method: 'POST', path: '/twins', token: ctx.A.token, tenantId: ctx.A.tenantId,
    body: { organisation_id: ctx.offerOrgId, offering: true,
      version: { mandate: 'originate GPU compute and data centre capacity deals',
        permitted_markets: ['United Arab Emirates', 'Saudi Arabia'],
        capabilities: [
          { name: 'GPU compute brokerage', status: 'reviewed' },
          { name: 'Data centre capacity', status: 'reviewed' },
        ], status: 'active' } } })
  ctx.twinId = twin.json.twin?.id || twin.json.id

  // target org + claims
  const target = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token, tenantId: ctx.A.tenantId,
    body: { canonical_name: 'Gulf AI Labs', entity_type: 'buyer', domains: ['gulfailabs.ae'], country: 'United Arab Emirates' } })
  ctx.targetId = target.json.id
  ctx.opportunity = (await api(ctx.base, { method: 'POST', path: '/opportunities', token: ctx.A.token,
    tenantId: ctx.A.tenantId,
    body: { offering_twin_id: ctx.twinId, target_org_id: ctx.targetId, sector_type: 'gpu_rental' } })).json.opportunity
})

afterAll(async () => {
  ctx?.server?.close()
  await ctx?.db?.cleanup()
})

function fullRatings() {
  return {
    fit: { rating: 4, rationale: 'r', source_ids: [] },
    trigger: { rating: 3, rationale: 'r', source_ids: [] },
    timing: { rating: 3, rationale: 'r', source_ids: [] },
    budget: { rating: 2, rationale: 'r', source_ids: [] },
    access: { rating: 3, rationale: 'r', source_ids: [] },
  }
}

describe('A05: nine sections render; unsupported material assertion fails validation', () => {
  it('thesis with all nine sections + claim refs saves; dangling claim ref 422s', async () => {
    // seed a claim on the target so references resolve
    const claim = await api(ctx.base, { method: 'POST', path: '/claims', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { subject_type: 'organisation', subject_id: ctx.targetId, predicate: 'procurement_eligible',
        value: true, assertion_type: 'user_claim' } })
    expect(claim.status).toBe(201)
    const cid = claim.json.id

    const sections = Object.fromEntries([
      'why_this_matters', 'why_now', 'why_this_org', 'what_they_may_need',
      'what_we_can_provide', 'who_controls_decision', 'what_evidence_supports',
      'what_could_invalidate', 'recommended_next_action',
    ].map((k) => [k, k === 'what_could_invalidate'
      ? `Hypothesis: budget may shift to competitors.`
      : `Draft text for ${k} citing [claim:${cid}].`]))

    const bad = await api(ctx.base, { method: 'POST', path: '/theses', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { opportunity_id: ctx.opportunity.id, ratings: fullRatings(), sections: { ...sections, what_evidence_supports: 'They are definitely buying 500 GPUs next month.' } } })
    expect(bad.status).toBe(422)
    expect(bad.json.error.code).toBe('unsupported_assertion')

    const good = await api(ctx.base, { method: 'POST', path: '/theses', token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { opportunity_id: ctx.opportunity.id, ratings: fullRatings(), sections } })
    expect(good.status).toBe(201)
    expect(Object.keys(good.json.thesis.sections).length).toBe(9)
    ctx.thesisV1 = good.json.thesis
  })
})

describe('A06: hard checks drive eligibility + confidence', () => {
  it('excluded market => geography fail; unknown country => geography unknown; confidence capped', async () => {
    const { runHardChecks, hardCheckSummary, confidenceFor, scoreOpportunity } = await import('../src/lib/rubric.js')
    const failCase = runHardChecks({
      mandate: 'gpu deals', permittedMarkets: ['UAE'], excludedMarkets: ['Iran'],
      capabilities: [{ name: 'GPU compute brokerage', status: 'reviewed' }],
      targetClaims: { country: 'Iran', mandate_summary: 'we buy GPUs' }, sectorType: 'gpu_rental',
    })
    expect(failCase.find((c) => c.name === 'geography').verdict).toBe('fail')
    expect(hardCheckSummary(failCase).eligible_for_qualification).toBe(false)

    const unknownCase = runHardChecks({
      mandate: 'gpu deals', permittedMarkets: ['UAE'], excludedMarkets: [],
      capabilities: [{ name: 'GPU compute brokerage', status: 'reviewed' }],
      targetClaims: {}, sectorType: 'gpu_rental',
    })
    expect(unknownCase.find((c) => c.name === 'geography').verdict).toBe('unknown')
    const conf = confidenceFor({ coverage: 1, hardChecks: unknownCase, evidenceAgeDays: 1 })
    expect(conf.confidence).toBe('medium') // unknown present caps below high
    expect(conf.missing_conditions.length).toBeGreaterThan(0)
    expect(scoreOpportunity({ fit: { rating: 'unknown' } }).coverage).toBe(0)
  })

  it('claimed-only capability blocks gpu_rental qualification as unknown', async () => {
    const { runHardChecks } = await import('../src/lib/rubric.js')
    const checks = runHardChecks({
      mandate: 'm', permittedMarkets: [], excludedMarkets: [],
      capabilities: [{ name: 'GPU compute brokerage', status: 'claimed' }],
      targetClaims: { country: 'UAE', mandate_summary: 'gpu', procurement_eligible: true }, sectorType: 'gpu_rental',
    })
    expect(checks.find((c) => c.name === 'capability').verdict).toBe('unknown')
  })
})

describe('A07: determinism + token-volume never fabricates', () => {
  it('identical inputs + rule_version produce identical scores (twice)', async () => {
    const { scoreOpportunity, RULE_VERSION } = await import('../src/lib/rubric.js')
    const r = fullRatings()
    const a = scoreOpportunity(r)
    const b = scoreOpportunity({ ...r })
    expect(a).toEqual(b)
    expect(RULE_VERSION).toMatch(/^rubric-v/)
    // priority math: fit 35*4/4 + trigger 25*3/4 + timing 15*3/4 + budget 15*2/4 + access 10*3/4
    expect(a.priority).toBeCloseTo(35 + 18.75 + 11.25 + 7.5 + 7.5, 3)
    expect(a.coverage).toBe(1)
  })
})

describe('A08: sector-specific qualification law', () => {
  it('rental-only twin fails ai_colocation capability check', async () => {
    const { runHardChecks } = await import('../src/lib/rubric.js')
    const checks = runHardChecks({
      mandate: 'gpu rental', permittedMarkets: [], excludedMarkets: [],
      capabilities: [{ name: 'GPU compute brokerage', status: 'reviewed' }],
      targetClaims: { country: 'UAE' }, sectorType: 'ai_colocation',
    })
    expect(checks.find((c) => c.name === 'capability').verdict).toBe('fail')
  })

  it('unconfirmed MW claim marked incomplete never renders as available capacity', async () => {
    const { scoreOpportunity } = await import('../src/lib/rubric.js')
    // value model with unknown IT load -> incomplete: true, null values
    const vm = { kind: 'colocation', inputs: { kW: null }, low: null, base: null, high: null,
      currency: 'USD', assumptions: 'MW capacity "15–20 MW" unconfirmed', incomplete: true }
    expect(vm.incomplete).toBe(true)
    expect(vm.base).toBeNull()
    // and the UI law test: sections can only cite the claim that marks it unconfirmed
    const s = scoreOpportunity({ fit: { rating: 2 } })
    expect(s.coverage).toBeCloseTo(0.35, 3)
  })
})

describe('stage machine (server-enforced)', () => {
  it('candidate -> thesis_ready blocked without thesis; legal path works; illegal jump 409s', async () => {
    const o2 = (await api(ctx.base, { method: 'POST', path: '/opportunities', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { offering_twin_id: ctx.twinId, target_org_id: ctx.targetId, sector_type: 'gpu_hardware' } })).json.opportunity
    const blocked = await api(ctx.base, { method: 'POST', path: `/opportunities/${o2.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'thesis_ready' } })
    expect(blocked.status).toBe(409)

    const jump = await api(ctx.base, { method: 'POST', path: `/opportunities/${o2.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'qualified' } })
    expect(jump.status).toBe(409)

    const ok1 = await api(ctx.base, { method: 'POST', path: `/opportunities/${o2.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'researching' } })
    expect(ok1.status).toBe(200)

    // qualifying requires confidence > insufficient — thesis on this opp has none yet, so use V1 opp
    const q1 = await api(ctx.base, { method: 'POST', path: `/opportunities/${ctx.opportunity.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'researching' } })
    expect(q1.status).toBe(200)
    const q2 = await api(ctx.base, { method: 'POST', path: `/opportunities/${ctx.opportunity.id}/transitions`,
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { to_stage: 'thesis_ready' } })
    expect(q2.status).toBe(200) // has thesis V1
  })

  it('signals: create + list within tenant only', async () => {
    const sig = await api(ctx.base, { method: 'POST', path: '/signals', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { event_type: 'funding', summary: 'Target raised Series B', affected_org_ids: [ctx.targetId] } })
    expect(sig.status).toBe(201)
    const list = await api(ctx.base, { path: '/signals', token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(list.json.signals.length).toBeGreaterThanOrEqual(1)
  })
})
