// server/src/routes/contactfinder.js — rung #3: turn stored discovery runs
// into people + contact evidence. DETERMINISTIC: no LLM, no guessed names —
// a person exists because the page showed them; a minted address is stored
// AS a guess (email_class='hypothesis'). Published ≠ deliverable; nothing is
// ever sent here — outreach stays behind plans + approvals (P4).
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'
import { trackEvent } from '../lib/events.js'
import { boundedFetch } from '../lib/discovery.js'
import { harvestEmailsFromHtml, harvestTeamLinks, harvestPersonSlugs, classifyEmail, looksLikeName, mintPatterns } from '../lib/contacts.js'

const MUTATOR = ['admin', 'analyst', 'commercial']
const TEAM_FETCH_CAP = 3

const findSchema = z.object({
  organisation_id: z.string().uuid(),
  run_id: z.string().uuid().nullable().optional(),
  follow_team_links: z.boolean().default(true), // bounded same-host team/about/contact fetch
  mint_patterns: z.boolean().default(true),     // pattern addresses for named people, class 'hypothesis'
})

export function createContactFinderRouter({ pool, fetchImpl } = {}) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))
  const jsonBody = express.json({ limit: '10kb' })

  router.post('/contacts/find', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const input = findSchema.parse(req.body ?? {})
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const org = await mustOrg(c, req.tenantId, input.organisation_id)
        const orgDomain = (org.domains?.[0] || '').toLowerCase().replace(/^www\./, '')

        // 1. snapshot sources: given run, else the org's latest ok run per URL
        const runs = input.run_id
          ? await runsForRunId(c, req.tenantId, input.run_id)
          : await latestRunsForOrg(c, req.tenantId, org.id)
        if (!runs.length) {
          const e = new Error('No ok discovery runs for this organisation'); e.status = 409; throw e
        }

        const created = { contacts: [], hypotheses: [], people_new: 0 }
        const seenEmails = new Set()
        const seenSlugs = new Set()
        const teamLinks = new Set()
        const runUrls = new Set()

        // 2. harvest stored snapshots (no network)
        for (const run of runs) {
          runUrls.add(run.requested_url)
          await harvestSnapshot(c, req, org.id, run.body, run.requested_url, { created, seenEmails, seenSlugs, teamLinks, runId: run.id })
        }

        // 3. bounded team-page follow: NEW same-host pages first (never the
        // already-stored run URLs), capped, SSRF-guarded; failures counted
        const followed = []
        const followFailures = []
        if (input.follow_team_links) {
          const fresh = [...teamLinks].filter((l) => !runUrls.has(l))
          for (const link of fresh.slice(0, TEAM_FETCH_CAP)) {
            let page
            try {
              page = await boundedFetch(link, { fetchImpl: fetchImpl || globalThis.fetch })
            } catch (err) {
              followFailures.push(`${link}: ${String(err.message).slice(0, 80)}`)
              continue
            }
            if (page.status !== 200) {
              followFailures.push(`${link}: http ${page.status}`)
              continue
            }
            try {
              await c.query(
                `INSERT INTO discovery_runs (tenant_id, organisation_id, requested_url, final_url, http_status, content_hash, bytes, extracted, status, run_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ok',$9)`,
                [req.tenantId, org.id, link, page.finalUrl, page.status, page.contentHash, page.bytes,
                 JSON.stringify({ title: `contact-finder follow: ${link}` }), req.user.id])
            } catch (err) {
              followFailures.push(`${link}: persist ${String(err.message).slice(0, 80)}`)
            }
            followed.push(link)
            await harvestSnapshot(c, req, org.id, page.snapshot, link, { created, seenEmails, seenSlugs, teamLinks, runId: null })
          }
        }

        // 4. mint pattern hypotheses for named people still without an email
        if (input.mint_patterns) {
          const { rows: named } = await c.query(
            `SELECT p.id, p.full_name FROM people p
              WHERE p.organisation_id = $1
                AND NOT EXISTS (SELECT 1 FROM contact_points cp WHERE cp.person_id = p.id AND cp.kind = 'email')
              ORDER BY p.created_at DESC LIMIT 20`, [org.id])
          for (const p of named.slice(0, 10)) {
            const parts = p.full_name.trim().split(/\s+/)
            if (parts.length < 2) continue
            const first = parts[0]
            const last = parts[parts.length - 1]
            if (!orgDomain) continue
            for (const pattern of mintPatterns(first, last, orgDomain)) {
              const addr = `${pattern}` // mintPatterns returns full addresses
              const cpId = await insertHypothesis(c, req, p.id, patternLabel(first, last, addr), addr,
                { first, last, domain: orgDomain, basis: 'name_from_page' })
              if (cpId) created.hypotheses.push({ person: p.full_name, address: addr, pattern: patternLabel(first, last, addr) })
            }
          }
        }

        await trackEvent(c, req.tenantId, 'contacts.find', {
          actorUserId: req.user.id,
          metadata: {
            organisation_id: org.id,
            contacts: created.contacts.length,
            hypotheses: created.hypotheses.length,
            people_new: created.people_new,
          },
        })

        return {
          organisation_id: org.id,
          contacts_created: created.contacts,
          hypotheses_created: created.hypotheses,
          people_new: created.people_new,
          followed_pages: followed,
          follow_failures: followFailures,
          team_links_found: [...teamLinks].slice(0, 10),
        }
      })
      res.status(201).json(out)
    } catch (err) { next(err) }
  })

  return router
}

// ---------------------------------------------------------------- helpers

async function mustOrg(c, tenantId, id) {
  const { rows } = await c.query(`SELECT id, canonical_name, domains FROM organisations WHERE id = $1`, [id])
  if (!rows.length) { const e = new Error('Organisation not found'); e.status = 404; throw e }
  return rows[0]
}

async function runsForRunId(c, tenantId, runId) {
  const { rows } = await c.query(
    `SELECT r.id, r.requested_url, s.body
       FROM discovery_runs r JOIN discovery_snapshots s ON s.run_id = r.id
      WHERE r.id = $1 AND r.tenant_id = $2 AND r.status = 'ok'`, [runId, tenantId])
  return rows
}

async function latestRunsForOrg(c, tenantId, orgId) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (r.requested_url) r.id, r.requested_url, s.body
       FROM discovery_runs r JOIN discovery_snapshots s ON s.run_id = r.id
      WHERE r.organisation_id = $1 AND r.tenant_id = $2 AND r.status = 'ok'
      ORDER BY r.requested_url, r.created_at DESC`, [orgId, tenantId])
  return rows
}

/** Harvest one raw snapshot: emails (+person), linkedin slugs, team links. */
async function harvestSnapshot(c, req, orgId, rawSnapshot, pageUrl, { created, seenEmails, seenSlugs, teamLinks, runId }) {
  const { rows: orgRows } = await c.query(`SELECT domains FROM organisations WHERE id = $1`, [orgId])
  const orgDomain = (orgRows[0]?.domains?.[0] || '').toLowerCase().replace(/^www\./, '')

  for (const e of harvestEmailsFromHtml(rawSnapshot)) {
    if (seenEmails.has(e.email)) continue
    seenEmails.add(e.email)
    const cls = classifyEmail(e.local, e.host, orgDomain)
    const name = looksLikeName(e.local) ? localToName(e.local) : null
    const res = await ensurePersonWithEmail(c, req, orgId, name, e.email, cls, runId, pageUrl)
    if (res?.isNew) created.people_new++
    if (res?.contactCreated) created.contacts.push({ email: e.email, email_class: cls, source: pageUrl })
  }

  for (const p of harvestPersonSlugs(rawSnapshot, pageUrl)) {
    if (seenSlugs.has(p.slug)) continue
    seenSlugs.add(p.slug)
    if (!p.name) continue // slug alone (no derivable name) is kept in team_links/evidence, not as a person
    const res = await ensurePersonWithLinkedin(c, req, orgId, p.name, p.url)
    if (res?.isNew) created.people_new++
  }

  for (const l of harvestTeamLinks(rawSnapshot, pageUrl)) teamLinks.add(l)
}

/** Find-or-create person by (org, name); attach the email as a contact point. */
async function ensurePersonWithEmail(c, req, orgId, name, email, emailClass, runId, pageUrl) {
  let personId = null
  let isNew = false
  if (name) {
    personId = await findOrCreateTimePerson(c, req, orgId, name,
      `contact finder: name derived from published address on ${pageUrl}`)
    isNew = personId.created
  } else {
    // address with no name: attach to an anonymous org placeholder so the
    // evidence is never lost (people.full_name is NOT NULL)
    personId = await findOrCreateAnon(c, req, orgId)
  }
  const { rows: existing } = await c.query(
    `SELECT id FROM contact_points WHERE person_id = $1 AND kind='email' AND lower(value) = lower($2) LIMIT 1`,
    [personId.id, email])
  if (existing.length) return { contactId: existing[0].id, isNew, contactCreated: false }
  const { rows } = await c.query(
    `INSERT INTO contact_points (tenant_id, person_id, kind, value, email_class, deliverability, notes, created_by)
     VALUES ($1,$2,'email',$3,$4,'untested',$5,$6) RETURNING id`,
    [req.tenantId, personId.id, email, emailClass,
     `harvested from ${pageUrl}${runId ? ` (run ${runId})` : ''}`, req.user.id])
  return { contactId: rows[0].id, isNew, contactCreated: true }
}

/** Find-or-create person from a LinkedIn slug with a derivable name. */
async function ensurePersonWithLinkedin(c, req, orgId, name, linkedinUrl) {
  const personId = await findOrCreateTimePerson(c, req, orgId, name,
    `contact finder: linkedin profile linked from public page (${linkedinUrl})`)
  if (!personId.created) {
    const already = (personId.notes || '').includes(linkedinUrl)
    if (!already) {
      await c.query(`UPDATE people SET notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`,
        [personId.id, `linkedin: ${linkedinUrl}`])
    }
  }
  return { isNew: personId.created }
}

async function findOrCreateTimePerson(c, req, orgId, name, note) {
  const { rows } = await c.query(
    `SELECT id, notes FROM people WHERE organisation_id = $1 AND lower(full_name) = lower($2) AND merged_into_id IS NULL LIMIT 1`,
    [orgId, name])
  if (rows.length) return { id: rows[0].id, notes: rows[0].notes, created: false }
  const { rows: inserted } = await c.query(
    `INSERT INTO people (tenant_id, full_name, organisation_id, is_public_person, notes, created_by)
     VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
    [req.tenantId, name, orgId, note, req.user.id])
  return { id: inserted[0].id, notes: note, created: true }
}

/** Anonymous org-scoped placeholder for nameless harvested addresses. */
async function findOrCreateAnon(c, req, orgId) {
  const NAME = '(unnamed contact)'
  const { rows } = await c.query(
    `SELECT id FROM people WHERE organisation_id = $1 AND full_name = $2 LIMIT 1`, [orgId, NAME])
  if (rows.length) return { id: rows[0].id, created: false }
  const { rows: anon } = await c.query(
    `INSERT INTO people (tenant_id, full_name, organisation_id, is_public_person, notes, created_by)
     VALUES ($1,$2,$3,true,'contact finder: unnamed — address harvested without a name on the page',$4) RETURNING id`,
    [req.tenantId, NAME, orgId, req.user.id])
  return { id: anon[0].id, created: true }
}

/** Idempotent per (person, address) hypothesis: contact_point + mint provenance. */
async function insertHypothesis(c, req, personId, patternLabelStr, address, meta) {
  const { rows: existing } = await c.query(
    `SELECT id FROM contact_points WHERE person_id = $1 AND kind='email' AND lower(value) = lower($2) LIMIT 1`,
    [personId, address])
  if (existing.length) return null
  const { rows } = await c.query(
    `INSERT INTO contact_points (tenant_id, person_id, kind, value, email_class, deliverability, notes, created_by)
     VALUES ($1,$2,'email',$3,'hypothesis','untested',$4,$5) RETURNING id`,
    [req.tenantId, personId, address,
     `pattern hypothesis (${patternLabelStr}); unverified guess; never auto-send`, req.user.id])
  await c.query(
    `INSERT INTO contact_hypotheses (tenant_id, contact_point_id, pattern, address, mint_meta, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.tenantId, rows[0].id, patternLabelStr, address, JSON.stringify(meta), req.user.id])
  return rows[0].id
}

function patternLabel(first, last, address) {
  const local = address.split('@')[0]
  if (local === first.toLowerCase()) return 'first'
  if (local === last.toLowerCase()) return 'last'
  if (local === `${first.toLowerCase()}.${last.toLowerCase()}`) return 'first.last'
  if (local === `${first.toLowerCase()[0]}${last.toLowerCase()}`) return 'flast'
  return 'other'
}

/** 'j.doe' -> 'J Doe'; 'jane.doe' -> 'Jane Doe'; first token may be an initial. */
function localToName(local) {
  const tokens = local.split(/[._-]+/).filter((t) => /^[a-z]{1,}$/i.test(t))
  if (tokens.length < 2 || tokens.length > 3) return null
  if (!tokens.slice(1).every((t) => t.length >= 2)) return null
  return tokens.map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()).join(' ')
}
