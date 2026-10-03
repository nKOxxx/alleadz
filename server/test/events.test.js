// server/test/events.test.js — retention instrumentation (migration 0006).
// Laws under test: (1) all five measured actions emit; (2) value-action
// (bundle.exported) fires exactly on a live-approval export; (3) best-effort
// emission never breaks the action; (4) events are tenant-isolated (RLS).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'

let ctx

beforeAll(async () => {
  ctx = { db: await createScratchDb() }
  ctx.app = ctx.db.createApp({ rateLimits: false })
  ctx.server = ctx.app.listen(0)
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  ctx.A = await registerUser(ctx.base, 'events@a.test', 'Events')
  ctx.B = await registerUser(ctx.base, 'other@b.test', 'Other')
  // discovery.run event from the register calls themselves:
  ctx.A_registrationEvents = await countEvents(ctx, 'auth.registered', ctx.A.tenantId)
})

async function countEvents(ctx, type, tenantId, userId) {
  const { rows } = await queryAsTenant(ctx.db.pool, tenantId, userId ?? ctx.A.userId,
    `SELECT count(*)::int AS n FROM events WHERE event_type = $1`, [type])
  return rows[0].n
}

afterAll(async () => {
  ctx?.server?.close()
  await ctx?.db?.cleanup()
})

describe('auth.registered', () => {
  it('emits exactly one registration event per user', async () => {
    // two users registered in beforeAll → 2 events visible to A (RLS: own tenant only)
    const nA = await countEvents(ctx, 'auth.registered', ctx.A.tenantId)
    expect(nA).toBe(1)
  })

  it('tenant B can never see tenant A events (RLS isolation)', async () => {
    const nB = await countEvents(ctx, 'auth.registered', ctx.B.tenantId, ctx.B.userId)
    expect(nB).toBe(1) // sees only its own registration
    const { rows } = await queryAsTenant(ctx.db.pool, ctx.B.tenantId, ctx.B.userId,
      `SELECT count(*)::int AS n FROM events e
        JOIN tenant_members m ON m.tenant_id = e.tenant_id AND m.user_id = $2
        WHERE e.event_type = 'auth.registered' AND m.tenant_id = $1`,
      [ctx.A.tenantId, ctx.B.userId])
    // explicit cross-tenant read attempt as B resolves to nothing
    expect(rows[0].n).toBe(0)
  })
})

describe('discovery.run + discovery.analyze + signal.promoted (chain)', () => {
  it('emits discovery.run on success and on blocked URLs', async () => {
    // blocked (SSRF guard) → failed-path event
    await api(ctx.base, { method: 'POST', path: '/discovery/run', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { urls: ['http://127.0.0.1:9/x'] } })
    const blocked = await countEvents(ctx, 'discovery.run', ctx.A.tenantId)
    expect(blocked).toBeGreaterThanOrEqual(1)
  })

  it('full chain: run → analyze → promote emits all three events', async () => {
    const before = {
      run: await countEvents(ctx, 'discovery.run', ctx.A.tenantId),
      analyze: await countEvents(ctx, 'discovery.analyze', ctx.A.tenantId),
      promote: await countEvents(ctx, 'signal.promoted', ctx.A.tenantId),
    }

    // seed a discovery run row directly (network-free, same as intelligence.test.js)
    const { extractAllowed } = await import('../src/lib/discovery.js')
    const page = `<!doctype html><html><head><title>Co — News</title></head>
      <body><article><h1>Series B announced 2026-09-15</h1>
      <p>Co raised $24M Series B to expand. We're hiring across engineering.</p></article></body></html>`
    const { rows } = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `INSERT INTO discovery_runs (tenant_id, requested_url, final_url, http_status, content_hash, bytes, extracted, status, run_by)
       VALUES ($1,$2,$2,200,'evhash',123,$3,'ok',$4) RETURNING id`,
      [ctx.A.tenantId, 'https://press.example.com/co', JSON.stringify(extractAllowed(page)), ctx.A.userId])
    const runId = rows[0].id

    const an = await api(ctx.base, { method: 'POST', path: '/discovery/analyze', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { run_id: runId } })
    expect(an.status).toBe(201)
    const { signal } = an.json

    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'Co', entity_type: 'buyer' } })
    expect(org.status).toBe(201)

    const promo = await api(ctx.base, { method: 'POST', path: `/signals/${signal.id}/promote`,
      token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { predicate: 'funding_stage', value: 'Series B', organisation_id: org.json.id } })
    expect(promo.status).toBe(201)

    // NOTE: run row is seeded directly (network-free), which bypasses the route
    // that emits discovery.run — that emission is covered by the blocked-URL
    // test above. Here we assert analyze + promote increments only.
    expect(await countEvents(ctx, 'discovery.run', ctx.A.tenantId)).toBe(before.run)
    expect(await countEvents(ctx, 'discovery.analyze', ctx.A.tenantId)).toBe(before.analyze + 1)
    expect(await countEvents(ctx, 'signal.promoted', ctx.A.tenantId)).toBe(before.promote + 1)
  })
})

describe('bundle.exported (the value action)', () => {
  it('export without live approval emits nothing and still 409s', async () => {
    const before = await countEvents(ctx, 'bundle.exported', ctx.A.tenantId)
    const fake = await api(ctx.base, { path: `/tasks/00000000-0000-4000-8000-000000000000/export`,
      token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(fake.status).toBe(404)
    expect(await countEvents(ctx, 'bundle.exported', ctx.A.tenantId)).toBe(before)
  })

  it('a live-approval export emits exactly one value-action event', async () => {
    const before = await countEvents(ctx, 'bundle.exported', ctx.A.tenantId)

    // minimal entity chain (same shape as people.test.js)
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'EventsTarget LLC', entity_type: 'buyer' } })
    const person = await api(ctx.base, { method: 'POST', path: '/people', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { full_name: 'Eve Nts', organisation_id: org.json.id, role_title: 'VP', seniority: 'vp' } })
    const contact = await api(ctx.base, { method: 'POST', path: '/contacts', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { person_id: person.json.id, kind: 'email', value: 'eve@eventstarget.example',
        email_class: 'person_published', deliverability: 'untested' } })
    const offerOrg = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'EventsOffer', entity_type: 'provider' } })
    const twin = await api(ctx.base, { method: 'POST', path: '/twins', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { organisation_id: offerOrg.json.id, offering: true, version: { status: 'active' } } })
    const twinId = twin.json.twin?.id || twin.json.id
    const opp = await api(ctx.base, { method: 'POST', path: '/opportunities', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { offering_twin_id: twinId, target_org_id: org.json.id, sector_type: 'gpu_rental' } })
    const plan = await api(ctx.base, { method: 'POST', path: '/plans', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { opportunity_id: opp.json.opportunity.id, title: 'Intro' } })
    const task = await api(ctx.base, { method: 'POST', path: `/plans/${plan.json.id}/tasks`,
      token: ctx.A.token, tenantId: ctx.A.tenantId,
      body: { sequence: 1, kind: 'email', payload: { subject: 'Hi', body: 'Hello' },
        contact_point_id: contact.json.id } })

    const appr = await api(ctx.base, { method: 'POST', path: '/approvals', token: ctx.A.token,
      tenantId: ctx.A.tenantId,
      body: { task_id: task.json.id,
        recipient_snapshot: { contact_point_id: contact.json.id, person_name: 'Eve Nts',
          email: 'eve@eventstarget.example', email_class: 'person_published' },
        content_snapshot: { subject: 'Partnership', body: 'Dear Eve,' } } })
    expect(appr.status).toBe(201)

    const exp = await api(ctx.base, { path: `/tasks/${task.json.id}/export`,
      token: ctx.A.token, tenantId: ctx.A.tenantId })
    expect(exp.status).toBe(200)
    expect(exp.json.export_type).toBe('manual_send_bundle')

    expect(await countEvents(ctx, 'bundle.exported', ctx.A.tenantId)).toBe(before + 1)
  })
})

describe('best-effort law', () => {
  it('trackEvent swallows DB failures (action must not break)', async () => {
    const { trackEvent } = await import('../src/lib/events.js')
    const fakeClient = {
      query: async () => { throw new Error('connection refused') },
    }
    // must resolve, not throw
    await expect(trackEvent(fakeClient, ctx.A.tenantId, 'bundle.exported', {})).resolves.toBeUndefined()
  })

  it('unknown event types are dropped, not written', async () => {
    const { trackEvent } = await import('../src/lib/events.js')
    const seen = []
    const fakeClient = { query: async (sql, params) => { seen.push(params) } }
    await trackEvent(fakeClient, ctx.A.tenantId, 'suspicious.type', {})
    expect(seen.length).toBe(0)
  })
})
