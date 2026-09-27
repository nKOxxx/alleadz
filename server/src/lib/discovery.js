// server/src/lib/discovery.js — bounded discovery adapter (P5).
// ONE transport (fetch), hard caps, retry with backoff, content snapshots,
// and an isolation boundary: adapter output NEVER reaches an LLM or a claim
// without passing through snapshot + extraction allowlist.

export const DISCOVERY_LIMITS = Object.freeze({
  maxBytes: 2_000_000,       // 2 MB per fetch
  timeoutMs: 15_000,
  maxRetries: 2,             // total attempts = 3
  maxPerRun: 10,             // URLs per run
  allowSchemes: ['http:', 'https:'],
  // SSRF guard: block loopback/link-local/private ranges by host literal.
  blockedHosts: /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i,
})

export function assertAllowedUrl(raw) {
  let u
  try { u = new URL(raw) } catch { const e = new Error('Invalid URL'); e.status = 400; throw e }
  if (!DISCOVERY_LIMITS.allowSchemes.includes(u.protocol)) {
    const e = new Error('Only http(s) URLs allowed'); e.status = 400; throw e
  }
  if (DISCOVERY_LIMITS.blockedHosts.test(u.hostname)) {
    const e = new Error('Blocked host (SSRF guard)'); e.status = 400; throw e
  }
  return u
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fetch with caps + retries. Returns {status, finalUrl, bytes, contentHash, snapshot}. */
export async function boundedFetch(rawUrl, { fetchImpl = fetch, logger = () => {} } = {}) {
  const u = assertAllowedUrl(rawUrl)
  let lastErr
  for (let attempt = 0; attempt <= DISCOVERY_LIMITS.maxRetries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DISCOVERY_LIMITS.timeoutMs)
    try {
      logger(`fetch attempt ${attempt + 1}: ${u.toString()}`)
      const res = await fetchImpl(u, { signal: ctrl.signal, redirect: 'follow' })
      clearTimeout(timer)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > DISCOVERY_LIMITS.maxBytes) {
        const e = new Error('Response exceeds 2 MB cap'); e.status = 413; throw e
      }
      const { createHash } = await import('node:crypto')
      const contentHash = createHash('sha256').update(buf).digest('hex')
      return {
        status: res.status,
        finalUrl: res.url || u.toString(),
        bytes: buf.length,
        contentHash,
        snapshot: buf.toString('utf8'),
      }
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (err.status) throw err // cap violations are permanent, not retryable
      if (attempt < DISCOVERY_LIMITS.maxRetries) await sleep(400 * 2 ** attempt)
    }
  }
  throw lastErr
}

/**
 * Extraction allowlist — the ONLY fields that may leave a snapshot.
 * Injection isolation: anything not on this list is discarded; free-text
 * excerpt is truncated and stripped of control chars.
 */
const ALLOWED_FIELDS = ['title', 'published_at', 'excerpt', 'jsonld_type']

export function extractAllowed(snapshot) {
  const out = {}
  const titleMatch = snapshot.match(/<title[^>]*>([^<]{1,300})<\/title>/i)
  if (titleMatch) out.title = titleMatch[1].replace(/\s+/g, ' ').trim()
  const dateMatch = snapshot.match(/(20\d{2}-\d{2}-\d{2})/)
  if (dateMatch) out.published_at = dateMatch[1]
  const body = snapshot
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (body) out.excerpt = body.slice(0, 1000)
  const typeMatch = snapshot.match(/"@type"\s*:\s*"([^"]+)"/)
  if (typeMatch) out.jsonld_type = typeMatch[1]
  for (const k of Object.keys(out)) {
    if (!ALLOWED_FIELDS.includes(k)) delete out[k]
    else if (typeof out[k] === 'string') out[k] = out[k].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  }
  return out
}
