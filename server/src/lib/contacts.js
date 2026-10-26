// server/src/lib/contacts.js — rung #3: deterministic contact finder.
// Harvests contact evidence from discovery snapshots ALREADY in the DB.
// No LLM anywhere: emails and names come off the page or they don't exist.
// Classes carry provenance (P4 law: published ≠ deliverable); pattern-minted
// addresses are flagged 'hypothesis' — a guess is stored AS a guess. Nothing
// is ever sent: outreach stays behind plans + approvals.
import { htmlDecode, stripTags } from './htmltext.js'

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const MAILTO_RE = /mailto:([^"'>\s]+)/gi

const JUNK_HOSTS = /(^|\.)(example\.(com|org)|domain\.com|email\.com|yourdomain\.(com|org)|sentry\.io|wixpress\.com|squarespace\.com|constantcontact\.com|sentry-next\.wixpress\.com)$/i
const JUNK_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot)$/i

const FUNCTIONAL_LOCAL = new Set(['info', 'contact', 'hello', 'support', 'sales', 'team',
  'mail', 'office', 'admin', 'careers', 'jobs', 'press', 'media', 'help', 'service',
  'services', 'enquiries', 'inquiries', 'welcome', 'hi', 'contactus', 'customerservice'])
const NON_COMMERCIAL_LOCAL = new Set(['privacy', 'legal', 'dpo', 'gdpr', 'abuse',
  'postmaster', 'webmaster', 'hostmaster', 'compliance', 'unsubscribe'])
const FREE_HOSTS = /(^|\.)(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.com|icloud\.com|me\.com|proton\.me|protonmail\.com|aol\.com|gmx\.(com|net)|mail\.com|yandex\.(com|ru))$/i

const TEAM_LINK_RE = /\/(about|team|people|contact|company|leadership|management|founders|staff|careers)([/?#-]|$)/i
const LINKEDIN_IN_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9%_-]{3,60})/g

/** A local part that looks like a person name: 2-3 alpha tokens split by . _ -;
 *  at most ONE may be a single-letter initial; none may be a role word.
 *  'j.doe' yes, 'jane.m.doe' yes, 'a.b' no, 'info' no, 'support.team' no. */
export function looksLikeName(local) {
  const tokens = local.toLowerCase().split(/[._-]+/).filter(Boolean)
  if (tokens.length < 2 || tokens.length > 3) return false
  if (!tokens.every((t) => /^[a-z]+$/.test(t))) return false
  if (tokens.filter((t) => t.length === 1).length > 1) return false
  return tokens.every((t) => !FUNCTIONAL_LOCAL.has(t) && !NON_COMMERCIAL_LOCAL.has(t))
}

/** Classification = provenance. Harvested addresses are NEVER 'hypothesis'. */
export function classifyEmail(local, host, orgDomain) {
  const l = local.toLowerCase()
  if (NON_COMMERCIAL_LOCAL.has(l) || NON_COMMERCIAL_LOCAL.has(l.split(/[._-]+/)[0])) {
    return 'non_commercial_inbox'
  }
  if (FUNCTIONAL_LOCAL.has(l) || FUNCTIONAL_LOCAL.has(l.split(/[._-]+/)[0])) {
    return 'functional_inbox'
  }
  const domain = (orgDomain || '').toLowerCase().replace(/^www\./, '')
  const onDomain = domain && (host === domain || host.endsWith(`.${domain}`))
  if (onDomain) return looksLikeName(l) ? 'person_published' : 'company_published'
  // not on the org's domain: a free-mail or third-party address — reported, weaker
  return 'third_party_reported'
}

export function harvestEmailsFromHtml(rawSnapshot, { cap = 25 } = {}) {
  const out = []
  const seen = new Set()
  const push = (candidate) => {
    let email = htmlDecode(candidate).trim().toLowerCase().replace(/[.,;:)\\]+$/, '')
    if (!email.includes('@')) return
    const at = email.lastIndexOf('@')
    const local = email.slice(0, at)
    const host = email.slice(at + 1)
    if (!local || !host || host.length > 253) return
    if (JUNK_EXT.test(email) || JUNK_HOSTS.test(host)) return
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return
    if (seen.has(email)) return
    seen.add(email)
    out.push({ email, local, host })
  }
  for (const m of rawSnapshot.matchAll(MAILTO_RE)) push(m[1])
  const text = stripTags(rawSnapshot)
  for (const m of text.matchAll(EMAIL_RE)) push(m[0])
  return out.slice(0, cap)
}

/** Same-host links that look like team/contact pages — next crawl targets. */
export function harvestTeamLinks(rawSnapshot, baseUrl, { cap = 5 } = {}) {
  const base = (() => { try { return new URL(baseUrl) } catch { return null } })()
  if (!base) return []
  const out = []
  const seen = new Set()
  for (const m of rawSnapshot.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u
    try { u = new URL(m[1], base) } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.hostname !== base.hostname) continue
    u.hash = ''
    const key = u.toString()
    if (seen.has(key)) continue
    if (TEAM_LINK_RE.test(u.pathname)) {
      seen.add(key)
      out.push(key)
      if (out.length >= cap) break
    }
  }
  return out
}

/** LinkedIn /in/ slugs → person evidence: {slug, name, url}. Deterministic:
 *  the slug IS on the page or the person doesn't exist here. */
export function harvestPersonSlugs(rawSnapshot, baseUrl, { cap = 10 } = {}) {
  const base = (() => { try { return new URL(baseUrl) } catch { return null } })()
  const out = []
  const seen = new Set()
  for (const m of rawSnapshot.matchAll(LINKEDIN_IN_RE)) {
    let slug
    try { slug = decodeURIComponent(m[1]) } catch { slug = m[1] }
    slug = slug.toLowerCase()
    if (seen.has(slug)) continue
    seen.add(slug)
    let name = null
    const raw = slug.replace(/[-_]+$/, '').replace(/-[a-z0-9]{6,}$/,'') // drop -123abc suffixes
    const tokens = raw.split(/[-_]+/).filter((t) => /^[a-z]{2,}$/.test(t))
    if (tokens.length >= 2 && tokens.length <= 3) {
      name = tokens.map((t) => t[0].toUpperCase() + t.slice(1)).join(' ')
    }
    out.push({ slug, name, url: base ? `https://www.linkedin.com/in/${slug}` : m[0] })
    if (out.length >= cap) break
  }
  return out
}

/** Pattern hypotheses for a person whose name we have but whose address we
 *  don't. Output is flagged 'hypothesis' by the caller — always. */
export function mintPatterns(firstName, lastName, orgDomain) {
  const domain = (orgDomain || '').toLowerCase().replace(/^www\./, '')
  if (!domain || !firstName || !lastName) return []
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '')
  if (!f || !l) return []
  return [...new Set([`${f}@${domain}`, `${l}@${domain}`, `${f}.${l}@${domain}`, `${f[0]}${l}@${domain}`])]
}
