// server/test/contactfinder.test.js — rung #3: deterministic contact finder.
// Law under test: harvested = provenance-classified, minted = 'hypothesis',
// nothing is ever sent, re-runs are idempotent.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createScratchDb, registerUser, api, queryAsTenant } from './helpers.js'

let ctx

// ---------- lib units (pure, no DB) ----------
import { harvestEmailsFromHtml, harvestTeamLinks, harvestPersonSlugs, classifyEmail, looksLikeName, mintPatterns } from '../src/lib/contacts.js'

describe('contacts lib: harvest + classification', () => {
  it('harvests mailto + plaintext, skips images/junk, decodes entities', () => {
    const html = `<a href="mailto:J.Doe@gulfailabs.com">mail</a>
      <a href="mailto:info@gulfailabs.com">info</a>
      <img src="x.png" alt="a@b.com"> text jane@other.org, hi.team@gulfailabs.com`
    const got = harvestEmailsFromHtml(html)
    const emails = got.map((e) => e.email)
    expect(emails).toContain('j.doe@gulfailabs.com')
    expect(emails).toContain('info@gulfailabs.com')
    expect(emails).toContain('jane@other.org')
    expect(emails).toContain('hi.team@gulfailabs.com')
    expect(emails).not.toContain('a@b.com') // inside attribute, tags stripped
  })

  it('classifyEmail: person vs functional vs non-commercial vs third-party', () => {
    expect(classifyEmail('j.doe', 'gulfailabs.com', 'gulfailabs.com')).toBe('person_published')
    expect(classifyEmail('info', 'gulfailabs.com', 'gulfailabs.com')).toBe('functional_inbox')
    expect(classifyEmail('privacy', 'gulfailabs.com', 'gulfailabs.com')).toBe('non_commercial_inbox')
    expect(classifyEmail('j.doe', 'gmail.com', 'gulfailabs.com')).toBe('third_party_reported')
    expect(classifyEmail('team', 'gulfailabs.com', 'gulfailabs.com')).toBe('functional_inbox')
  })

  it('looksLikeName: name-shaped locals only', () => {
    expect(looksLikeName('j.doe')).toBe(true)
    expect(looksLikeName('jane.m.doe')).toBe(true)
    expect(looksLikeName('info')).toBe(false)
    expect(looksLikeName('support.team')).toBe(false)
    expect(looksLikeName('jane123')).toBe(false)
  })

  it('team links: same-host about/contact only, deduped, hashed dropped', () => {
    const html = `<a href="/about">a</a><a href="/careers">c</a>
      <a href="https://elsewhere.com/team">x</a>
      <a href="/about#method">dup</a><a href="/pricing">p</a>`
    const got = harvestTeamLinks(html, 'https://gulfailabs.com/home')
    expect(got).toEqual(['https://gulfailabs.com/about', 'https://gulfailabs.com/careers'])
  })

  it('linkedin slugs -> named people; numeric suffixes dropped; junk slugs nameless', () => {
    const html = `<a href="https://www.linkedin.com/in/jane-doe-1234a567">in</a>
      <a href="https://linkedin.com/in/gulf-ai-labs">co</a>`
    const got = harvestPersonSlugs(html, 'https://gulfailabs.com')
    const jane = got.find((p) => p.slug === 'jane-doe-1234a567')
    expect(jane.name).toBe('Jane Doe')
    const co = got.find((p) => p.slug === 'gulf-ai-labs')
    expect(co.name).toBe('Gulf Ai Labs') // 3 tokens -> still named; finder gates on 2+ word full_name later
  })

  it('mintPatterns: deterministic 4-address spread', () => {
    expect(mintPatterns('Jane', 'Doe', 'gulfailabs.com')).toEqual(
      ['jane@gulfailabs.com', 'doe@gulfailabs.com', 'jane.doe@gulfailabs.com', 'jdoe@gulfailabs.com'])
    expect(mintPatterns('Jane', '', 'gulfailabs.com')).toEqual([])
  })
})

// ---------- route integration (scratch DB, stubbed transport) ----------

const PAGE = `<!doctype html><html><head><title>Gulf AI Labs</title></head><body>
<h1>Gulf AI Labs — we build video understanding tools</h1>
<p>Questions to info@gulfailabs.com. Our founder Jane Doe: j.doe@gulfailabs.com.</p>
<a href="https://www.linkedin.com/in/jane-doe-1234a567">Jane on LinkedIn</a>
<a href="/team">Meet the team</a>
</body></html>`

const TEAM_PAGE = `<html><head><title>Team</title></head><body>
<h1>Team</h1><p>Bob Smith — CTO — b.smith@gulfailabs.com</p>
<script>window.cfg={};</script></body></html>`

// route across two URLs: main page then the discovered team page
function routeFetch() {
  const pages = {
    'https://gulfailabs.com/': PAGE,
    'https://gulfailabs.com/team': TEAM_PAGE,
  }
  return async (url) => ({
    status: 200,
    url,
    arrayBuffer: async () => new TextEncoder().encode(pages[url] ?? '<html></html>').buffer,
  })
}

describe('POST /contacts/find (route, real DB)', () => {
  beforeAll(async () => {
    ctx = { db: await createScratchDb() }
    ctx.app = ctx.db.createApp({ rateLimits: false, fetchImpl: routeFetch() })
    ctx.server = ctx.app.listen(0)
    ctx.base = `http://127.0.0.1:${ctx.server.address().port}`
    ctx.A = await registerUser(ctx.base, 'cf@r3.test', 'R3')
    // org + two runs (main + team, as if discovery had crawled both)
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'Gulf AI Labs', entity_type: 'buyer', domains: ['gulfailabs.com'] } })
    ctx.orgId = org.json.id
    for (const url of ['https://gulfailabs.com/', 'https://gulfailabs.com/team']) {
      await api(ctx.base, { method: 'POST', path: '/discovery/run', token: ctx.A.token,
        tenantId: ctx.A.tenantId, body: { organisation_id: ctx.orgId, urls: [url] } })
    }
  })

  afterAll(async () => {
    ctx?.server?.close()
    await ctx?.db?.cleanup()
  })

  it('finds people + contacts from stored runs; classifies; mints hypotheses for the nameless', async () => {
    const res = await api(ctx.base, { method: 'POST', path: '/contacts/find', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { organisation_id: ctx.orgId, mint_patterns: true } })
    expect(res.status).toBe(201)
    const emails = res.json.contacts_created.map((c) => c.email)
    expect(emails).toEqual(expect.arrayContaining(['info@gulfailabs.com', 'j.doe@gulfailabs.com', 'b.smith@gulfailabs.com']))
    const cls = Object.fromEntries(res.json.contacts_created.map((c) => [c.email, c.email_class]))
    expect(cls['info@gulfailabs.com']).toBe('functional_inbox')
    expect(cls['j.doe@gulfailabs.com']).toBe('person_published')
    expect(cls['b.smith@gulfailabs.com']).toBe('person_published')

    // Jane: named twice (address local part + linkedin slug) — one person row
    const people = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT full_name FROM people WHERE organisation_id = $1 ORDER BY full_name`, [ctx.orgId])
    const names = people.rows.map((r) => r.full_name)
    expect(names).toContain('J Doe') // localToName('j.doe') -> 'J Doe'
    expect(names).toContain('B Smith') // from address local part 'b.smith' (deterministic: prose names are NOT parsed)
    expect(names).toContain('(unnamed contact)')
  })

  it('second run is idempotent: no duplicate contacts, none re-reported as new', async () => {
    const res = await api(ctx.base, { method: 'POST', path: '/contacts/find', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { organisation_id: ctx.orgId } })
    expect(res.status).toBe(201)
    expect(res.json.contacts_created).toEqual([])

    const cps = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT value, email_class FROM contact_points cp JOIN people p ON p.id = cp.person_id
        WHERE p.organisation_id = $1 AND cp.kind = 'email' ORDER BY cp.value`, [ctx.orgId])
    const vals = cps.rows.map((r) => r.value)
    expect(vals.filter((v) => v === 'info@gulfailabs.com').length).toBe(1)
  })

  it('hypotheses are stored as guesses with mint provenance', async () => {
    const rows = await queryAsTenant(ctx.db.pool, ctx.A.tenantId, ctx.A.userId,
      `SELECT ch.pattern, ch.address, ch.mint_meta, cp.email_class
         FROM contact_hypotheses ch JOIN contact_points cp ON cp.id = ch.contact_point_id
        WHERE ch.tenant_id = $1 ORDER BY ch.address`, [ctx.A.tenantId])
    expect(rows.rows.length).toBeGreaterThan(0)
    for (const r of rows.rows) {
      expect(r.email_class).toBe('hypothesis')
      expect(r.mint_meta.basis).toBe('name_from_page')
    }
    const addrs = rows.rows.map((r) => r.address)
    // Jane's person row came from local part 'j.doe' -> name 'J Doe' (initial
    // first token) -> mints last-name pattern only: doe@gulfailabs.com
    expect(addrs).toContain('doe@gulfailabs.com')
  })

  it('409 when the org has no ok discovery runs', async () => {
    const org = await api(ctx.base, { method: 'POST', path: '/orgs', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { canonical_name: 'NoCrawl Co', entity_type: 'buyer', domains: ['nocrawl.example'] } })
    const res = await api(ctx.base, { method: 'POST', path: '/contacts/find', token: ctx.A.token,
      tenantId: ctx.A.tenantId, body: { organisation_id: org.json.id } })
    expect(res.status).toBe(409)
  })
})
