// server/test/verticals.test.js — lane presets + gate (blueprint-audit fix 4).
// Laws under test: (1) curated lanes are listable; (2) apply seeds mandate
// twin + preset + lane and emits vertical.applied exactly once; (3) re-apply
// is idempotent (no duplicate twins/orgs, versioned twin_versions); (4) lane
// gate deterministically fails sanctions/LATAM geos and sub-$1M deposits;
// (5) gate integrates into rubric hard checks; (6) RLS isolates presets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'
import { runLaneGate, extractCues, getPreset, laneKeyOf } from '../src/lib/verticals.js'
import { runHardChecks, hardCheckSummary } from '../src/lib/rubric.js'

let ctx

beforeAll(async () => {
  ctx = { db: await createScratchDb() }
  ctx.app = ctx.db.createApp({ rateLimits: false })
  ctx.server = ctx.app.listen(0)
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  ctx.A = await registerUser(ctx.base, 'lanes@a.test', 'LaneA')
  ctx.B = await registerUser(ctx.base, 'other@b.test', 'LaneB')
})

afterAll(async () => {
  ctx?.server?.close()
  await ctx?.db?.cleanup()
})

describe('lane catalog', () => {
  it('requires auth', async () => {
    const r = await api(ctx.base, { path: '/verticals' })
    expect(r.status).toBe(401)
  })

  it('lists exactly the two curated lanes with templates', async () => {
    const r = await api(ctx.base, { path: '/verticals', token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(r.status).toBe(200)
    expect(r.json.current).toBeNull()
    const keys = r.json.lanes.map((l) => l.key)
    expect(keys.sort()).toEqual(['bank-frick', 'own-products'])
    const bf = r.json.lanes.find((l) => l.key === 'bank-frick')
    expect(bf.template.title).toContain('RM call sheet')
    expect(bf.gate.min_expected_deposit_usd).toBe(1_000_000)
    const op = r.json.lanes.find((l) => l.key === 'own-products')
    expect(op.template.title).toContain('Founder outreach')
  })
})

describe('apply', () => {
  it('requires auth + valid lane', async () => {
    expect((await api(ctx.base, { method: 'POST', path: '/verticals/apply', body: { lane: 'bank-frick' } })).status).toBe(401)
    expect((await api(ctx.base, { method: 'POST', path: '/verticals/apply', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { lane: 'hedge-funds' } })).status).toBe(400)
  })

  it('seeds twin + preset, sets lane, emits vertical.applied once', async () => {
    const r = await api(ctx.base, { method: 'POST', path: '/verticals/apply',
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { lane: 'bank-frick' } })
    expect(r.status).toBe(201)
    expect(r.json.lane).toBe('bank-frick')
    ctx.twinId = r.json.twin_id
    ctx.twinVersionId = r.json.twin_version_id

    // tenant lane set, twin ACTIVE with mandate + exclusions, preset row stored
    const { rows: [t] } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT lane FROM tenants WHERE id = $1`, [ctx.A.tenantId])
    expect(t.lane).toBe('bank-frick')

    const { rows: [tv] } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT * FROM twin_versions WHERE id = $1`, [ctx.twinVersionId])
    expect(tv.status).toBe('active')
    expect(tv.mandate).toContain('professional market participants')
    expect(tv.excluded_markets).toContain('Iran')
    expect(tv.constraints.min_expected_deposit_usd).toBe(1_000_000)

    const { rows: [preset] } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT * FROM vertical_presets WHERE tenant_id = $1 AND key = 'bank-frick'`, [ctx.A.tenantId])
    expect(preset.config.exportTemplate).toBe('rm_call_sheet')

    const { rows: [ev] } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT count(*)::int AS n FROM events WHERE event_type = 'vertical.applied'`, [])
    expect(ev.n).toBe(1)
  })

  it('re-apply is idempotent: no twin/org duplication, versions advance', async () => {
    const r = await api(ctx.base, { method: 'POST', path: '/verticals/apply',
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { lane: 'bank-frick' } })
    expect(r.status).toBe(201)
    expect(r.json.twin_id).toBe(ctx.twinId)
    expect(r.json.twin_version_id).not.toBe(ctx.twinVersionId)

    const { rows } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT (SELECT count(*)::int FROM twins) AS twins,
              (SELECT count(*)::int FROM organisations) AS orgs,
              (SELECT count(*)::int FROM twin_versions WHERE twin_id = $1) AS versions,
              (SELECT count(*)::int FROM events WHERE event_type = 'vertical.applied') AS evs`,
      [ctx.twinId])
    expect(rows[0].twins).toBe(1)
    expect(rows[0].orgs).toBe(1)
    expect(rows[0].versions).toBe(2)
    expect(rows[0].evs).toBe(2)
  })

  it('switching lanes flips tenants.lane; presets coexist per key', async () => {
    const r = await api(ctx.base, { method: 'POST', path: '/verticals/apply',
      token: ctx.A.token, tenantId: ctx.A.tenantId, body: { lane: 'own-products' } })
    expect(r.status).toBe(201)
    const { rows: [t] } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT lane FROM tenants WHERE id = $1`, [ctx.A.tenantId])
    expect(t.lane).toBe('own-products')
    const { rows: presets } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT key FROM vertical_presets WHERE tenant_id = $1 ORDER BY key`, [ctx.A.tenantId])
    expect(presets.map((p) => p.key)).toEqual(['bank-frick', 'own-products'])
  })

  it('tenant B cannot read tenant A presets (RLS)', async () => {
    const r = await queryAsTenant(ctx.db.pool, ctx.B.tenantId, ctx.B.userId,
      `SELECT count(*)::int AS n FROM vertical_presets`, [])
    expect(r.rows[0].n).toBe(0)
  })
})

describe('lane gate (pure)', () => {
  const cases = [
    [{ country: 'Iran' }, 'fail'],
    [{ country: 'Russian Federation' }, 'fail'],
    [{ country: 'Sao Paulo, Brazil' }, 'fail'],
    [{ country: 'Liechtenstein' }, 'unknown'],   // no deposit claim yet
    [{ country: 'Germany', expected_deposit_usd: 999_999 }, 'fail'],
    [{ country: 'Germany', expected_deposit_usd: 5_000_000 }, 'pass'],
  ]
  for (const [claims, verdict] of cases) {
    it(`bank-frick ${JSON.stringify(claims)} → ${verdict}`, () => {
      expect(runLaneGate('bank-frick', claims).verdict).toBe(verdict)
    })
  }

  it('own-products has no geo/deposit exclusions', () => {
    expect(runLaneGate('own-products', { country: 'Brazil' }).verdict).toBe('pass')
  })

  it('cue extraction is deterministic', () => {
    const hits = extractCues('bank-frick', 'Hiring an MLRO after being unbanked by their previous bank.')
    const cats = hits.map((h) => h.category)
    expect(cats).toContain('compliance_hiring')
    expect(cats).toContain('banking_partner_gap')
    expect(hits.every((h) => h.cue && h.cue.length > 0)).toBe(true)
  })

  it('laneKeyOf identifies lanes from mandate text', () => {
    expect(laneKeyOf(getPreset('bank-frick').twin.version.mandate)).toBe('bank-frick')
    expect(laneKeyOf(getPreset('own-products').twin.version.mandate)).toBe('own-products')
    expect(laneKeyOf('sell paperclips')).toBeNull()
  })
})

describe('rubric integration', () => {
  const mandate = getPreset('bank-frick').twin.version.mandate

  it('lane gate appears in hard checks and blocks qualification', () => {
    const checks = runHardChecks({
      mandate,
      excludedMarkets: getPreset('bank-frick').twin.version.excluded_markets,
      targetClaims: { mandate_summary: 'digital asset custody for professional market participants',
        country: 'Iran', expected_deposit_usd: 5_000_000 },
    })
    const gate = checks.find((c) => c.name === 'lane_gate')
    expect(gate.verdict).toBe('fail')
    expect(hardCheckSummary(checks).eligible_for_qualification).toBe(false)
  })

  it('qualified target passes the gate', () => {
    const checks = runHardChecks({
      mandate,
      excludedMarkets: getPreset('bank-frick').twin.version.excluded_markets,
      targetClaims: { mandate_summary: 'digital asset custody for professional market participants',
        country: 'Switzerland', expected_deposit_usd: 2_000_000 },
    })
    expect(checks.find((c) => c.name === 'lane_gate').verdict).toBe('pass')
  })
})
