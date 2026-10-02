// server/test/auth.test.js
// P1 gate: auth flows, tenant resolution, role gates, rate limits.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, usingRealDatabase, registerUser, api } from './helpers.js'

const ctx = {}

beforeAll(async () => {
  if (usingRealDatabase()) {
    ctx.db = await createScratchDb()
    // rateLimits off in integration tests (a dedicated unit test covers the limiter)
    ctx.app = ctx.db.createApp({ rateLimits: false })
    ctx.server = ctx.app.listen(0)
    ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
  }
})

afterAll(async () => {
  if (ctx.server) ctx.server.close()
  if (ctx.db) await ctx.db.cleanup()
})

describe.skipIf(!usingRealDatabase())('auth + tenancy (P1)', () => {
  it('register -> 201 with token + tenant; duplicate email -> 409', async () => {
    const first = await api(ctx.base, {
      method: 'POST', path: '/auth/register',
      body: { email: 'a@t1.test', password: 'password123', workspaceName: 'Tenant One' },
    })
    expect(first.status).toBe(201)
    expect(first.json.token).toBeTruthy()
    expect(first.json.tenant.id).toBeTruthy()

    const dup = await api(ctx.base, {
      method: 'POST', path: '/auth/register',
      body: { email: 'a@t1.test', password: 'password123' },
    })
    expect(dup.status).toBe(409)
  })

  it('weak password rejected; login works; generic 401 on bad password', async () => {
    const weak = await api(ctx.base, {
      method: 'POST', path: '/auth/register', body: { email: 'w@t1.test', password: 'short' },
    })
    expect(weak.status).toBe(400)

    const login = await api(ctx.base, {
      method: 'POST', path: '/auth/login', body: { email: 'a@t1.test', password: 'password123' },
    })
    expect(login.status).toBe(200)
    // v1.0 contract (found by real-UI E2E): login returns the caller's workspace so the
    // SPA can set X-Tenant-Id immediately. Login without tenant = dead shell.
    expect(login.json.tenant).toBeTruthy()
    expect(login.json.tenant.id).toBeTruthy()
    expect(login.json.tenant.name).toBe('Tenant One')

    const bad = await api(ctx.base, {
      method: 'POST', path: '/auth/login', body: { email: 'a@t1.test', password: 'wrongpassword' },
    })
    expect(bad.status).toBe(401)
    expect(bad.json.error.message).toBe('Invalid email or password')
  })

  it('harness law: the app pool must NOT connect as a superuser/bypassrls role (RLS would silently not bite)', async () => {
    const { rows } = await ctx.db.pool.query(
      'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    )
    expect(rows[0].rolsuper).toBe(false)
    expect(rows[0].rolbypassrls).toBe(false)
  })

  it('A01: tenant A token cannot read or mutate tenant B resources', async () => {
    const A = await registerUser(ctx.base, 'a2@t1.test', 'A Corp')
    const B = await registerUser(ctx.base, 'b@t2.test', 'B Corp')

    // A creates an org
    const org = await api(ctx.base, {
      method: 'POST', path: '/orgs', token: A.token, tenantId: A.tenantId,
      body: { canonical_name: 'Secret GmbH', entity_type: 'buyer' },
    })
    expect(org.status).toBe(201)
    const orgId = org.json.id

    // B (valid member of tenant B) tries to read A's org -> 404 (invisible)
    const readAsB = await api(ctx.base, { path: `/orgs/${orgId}`, token: B.token, tenantId: B.tenantId })
    expect(readAsB.status).toBe(404)

    // B forges A's tenant id with own token -> membership check -> 403
    const forged = await api(ctx.base, { path: `/orgs/${orgId}`, token: B.token, tenantId: A.tenantId })
    expect(forged.status).toBe(403)

    // B tries to mutate into A's tenant -> 403
    const mut = await api(ctx.base, {
      method: 'POST', path: '/orgs', token: B.token, tenantId: A.tenantId,
      body: { canonical_name: 'Injected Co' },
    })
    expect(mut.status).toBe(403)

    // missing tenant header -> 400
    const noHeader = await api(ctx.base, { path: '/orgs', token: A.token })
    expect(noHeader.status).toBe(400)

    // unauthenticated -> 401
    const noAuth = await api(ctx.base, { path: '/orgs' })
    expect(noAuth.status).toBe(401)
  })

  it('A02: records persist; twin versions immutable', async () => {
    const U = await registerUser(ctx.base, 'persist@t1.test', 'Persist WS')
    const org = await api(ctx.base, {
      method: 'POST', path: '/orgs', token: U.token, tenantId: U.tenantId,
      body: { canonical_name: 'TargetCo', entity_type: 'buyer', domains: ['targetco.example'] },
    })
    const orgId = org.json.id

    const twin = await api(ctx.base, {
      method: 'POST', path: '/twins', token: U.token, tenantId: U.tenantId,
      body: {
        organisation_id: orgId, offering: true,
        version: { mandate: 'Provide GPU compute in GCC', status: 'active' },
      },
    })
    expect(twin.status).toBe(201)
    const twinId = twin.json.twin.id
    expect(twin.json.version.version).toBe(1)

    const v2 = await api(ctx.base, {
      method: 'POST', path: `/twins/${twinId}/versions`, token: U.token, tenantId: U.tenantId,
      body: { mandate: 'Provide GPU compute in GCC + EU', status: 'active' },
    })
    expect(v2.status).toBe(201)
    expect(v2.json.version).toBe(2)

    const back = await api(ctx.base, { path: `/twins/${twinId}`, token: U.token, tenantId: U.tenantId })
    expect(back.json.versions).toHaveLength(2)
    expect(back.json.versions.map((v) => v.version).sort()).toEqual([1, 2])
    expect(back.json.versions.find((v) => v.version === 1).mandate).toBe('Provide GPU compute in GCC')
  })

  it('evidence law: inference claim without rationale -> 400; unknown source ref -> 400', async () => {
    const U = await registerUser(ctx.base, 'evidence@t1.test', 'Evidence WS')
    const bad = await api(ctx.base, {
      method: 'POST', path: '/claims', token: U.token, tenantId: U.tenantId,
      body: {
        subject_type: 'organisation', subject_id: '00000000-0000-0000-0000-000000000001',
        predicate: 'has_gpu_need', value: true, assertion_type: 'inference',
      },
    })
    expect(bad.status).toBe(400)

    const org = await api(ctx.base, {
      method: 'POST', path: '/orgs', token: U.token, tenantId: U.tenantId,
      body: { canonical_name: 'ClaimTarget' },
    })
    const ghostSource = await api(ctx.base, {
      method: 'POST', path: '/claims', token: U.token, tenantId: U.tenantId,
      body: {
        subject_type: 'organisation', subject_id: org.json.id,
        predicate: 'country', value: 'AE', assertion_type: 'sourced_fact',
        evidence_source_ids: ['11111111-1111-1111-1111-111111111111'],
      },
    })
    expect(ghostSource.status).toBe(400)
    expect(ghostSource.json.error.code).toBe('unknown_source')

    const src = await api(ctx.base, {
      method: 'POST', path: '/sources', token: U.token, tenantId: U.tenantId,
      body: { kind: 'url', url: 'https://example.com/pr', source_type: 'press', publisher: 'Example Wire' },
    })
    expect(src.status).toBe(201)
    const ok = await api(ctx.base, {
      method: 'POST', path: '/claims', token: U.token, tenantId: U.tenantId,
      body: {
        subject_type: 'organisation', subject_id: org.json.id,
        predicate: 'announced_expansion', value: { note: 'press release exists' },
        assertion_type: 'sourced_fact', evidence_source_ids: [src.json.id],
      },
    })
    expect(ok.status).toBe(201)
  })

  it('viewer-role member cannot mutate; admin reads audit', async () => {
    const admin = await registerUser(ctx.base, 'admin@t1.test', 'Roles WS')
    // add a viewer member directly via pool (invite flow is P7)
    const { pool } = ctx.db
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ('viewer@t1.test', 'x') RETURNING id`,
    )
    await pool.query(
      `INSERT INTO tenant_members (tenant_id, user_id, roles) VALUES ($1, $2, ARRAY['viewer']::text[])`,
      [admin.tenantId, rows[0].id],
    )
    const viewerLogin = await api(ctx.base, {
      method: 'POST', path: '/auth/login', body: { email: 'viewer@t1.test', password: 'x' },
    })
    expect(viewerLogin.status).toBe(401) // scrypt hash 'x' won't verify; viewer uses direct session instead:

    // direct session for viewer
    const { createSession } = await import('../src/auth/sessions.js')
    const session = await createSession(pool, rows[0].id)

    const read = await api(ctx.base, { path: '/orgs', token: session.token, tenantId: admin.tenantId })
    expect(read.status).toBe(200)

    const write = await api(ctx.base, {
      method: 'POST', path: '/orgs', token: session.token, tenantId: admin.tenantId,
      body: { canonical_name: 'Should Fail' },
    })
    expect(write.status).toBe(403)

    const auditRead = await api(ctx.base, { path: '/audit', token: admin.token, tenantId: admin.tenantId })
    expect(auditRead.status).toBe(200)
    expect(auditRead.json.events.length).toBeGreaterThan(0)
  })
})
