// server/src/lib/intelligence.js — deterministic signal extraction from discovery snapshots.
// NO LLM, NO free-form inference: pure regex/structure passes over the extracted snapshot text.
// Every finding carries the evidence it came from (run_id + excerpt window), so promoting a
// finding to a claim always has source_ids. Injection isolation: input is the ALREADY-allowlisted
// `extracted` object from lib/discovery.js (title/excerpt/published_at/jsonld_type), not raw HTML.

export const SIGNAL_PATTERNS = Object.freeze([
  {
    event_type: 'funding',
    label: 'Funding announcement',
    // raised / series X / seed round / Series A/B/C, funding verb patterns
    re: /\b(raised|raises|closing|secured)\b[^.]{0,80}?\b(seed|pre-seed|series [abc]|series a|series b|series c|growth round|series)\b|\b(series [abc]|seed round|pre-seed)\b[^.]{0,60}?\b(raised|financing|funding)\b| funding (round|announcement) /i,
    claim_predicate: 'funding_stage',
    strength: 'strong',
  },
  {
    event_type: 'hiring',
    label: 'Hiring signal',
    re: /\b(we'?re hiring|now hiring|is hiring|join (our|the) team|open (positions|roles|roles)|careers?\b)/i,
    claim_predicate: 'hiring',
    strength: 'medium',
  },
  {
    event_type: 'product_launch',
    label: 'Product launch',
    re: /\b(introducing|launch(es|ed|ing)?|announc(e|es|ing)ing?|now available|generally available|ga\b|new (product|release|version))/i,
    claim_predicate: 'product_launch',
    strength: 'medium',
  },
  {
    event_type: 'partnership',
    label: 'Partnership',
    re: /\b(partnership|partner(s|ed|ing)? with|strategic alliance|integrat(es|ion|ing)? with)\b/i,
    claim_predicate: 'partnership',
    strength: 'medium',
  },
  {
    event_type: 'expansion',
    label: 'Market/office expansion',
    re: /\b(expand(s|ing)? (into|to)|new office|opens? (office|hq)|now (live|available) in)\b/i,
    claim_predicate: 'expansion',
    strength: 'medium',
  },
])

// Budget/pain cue words that make a signal MORE interesting to a seller — deterministic lexicon.
export const PAIN_LEXICON = Object.freeze([
  'spreadsheet', 'manual', 'outdated', 'legacy', 'struggling', 'frustrat',
  'bottleneck', 'inefficien', 'too slow', 'error-prone', 'overwhelm',
  'duct tape', 'workaround', 'chaos', 'broken',
])

/** Split excerpt into sentence-ish windows (100–240 chars) for evidence quoting. */
export function sentenceWindows(text) {
  const parts = String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?:[.!?]+\s+)|(?:\s+(?=[A-Z][a-z]+ (?:raised|introduc|launch|announc|partner)))/)
  const out = []
  for (const p of parts) {
    if (!p) continue
    const s = p.trim()
    if (s.length >= 30) out.push(s.slice(0, 240))
    if (out.length >= 12) break
  }
  return out
}

/**
 * Analyze one discovery run's extracted payload.
 * Returns findings: [{event_type, label, strength, excerpt, predicate}] plus
 * pain_cues found. Empty when nothing matched — silence is honest.
 */
export function analyzeExtracted(extracted) {
  const findings = []
  const text = `${extracted?.title || ''}. ${extracted?.excerpt || ''}`
  const seen = new Set()
  for (const pat of SIGNAL_PATTERNS) {
    const m = text.match(pat.re)
    if (!m) continue
    // evidence window: the sentence containing the match
    const windows = sentenceWindows(extracted?.excerpt || text)
    const hit = windows.find((w) => pat.re.test(w)) || text.slice(Math.max(0, (m.index || 0) - 80), (m.index || 0) + 160)
    const key = `${pat.event_type}:${hit.slice(0, 60)}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({
      event_type: pat.event_type,
      label: pat.label,
      strength: pat.strength,
      predicate: pat.claim_predicate,
      excerpt: hit,
    })
  }
  const lower = text.toLowerCase()
  const pain_cues = PAIN_LEXICON.filter((k) => lower.includes(k))
  return { findings, pain_cues }
}

/** Confidence of a finding as a claim candidate (deterministic rubric, no LLM). */
export function findingConfidence(finding, extracted) {
  let score = 0.3
  if (finding.strength === 'strong') score += 0.3
  if (extracted?.published_at) score += 0.2
  if (extracted?.title) score += 0.1
  if ((extracted?.excerpt || '').length > 300) score += 0.1
  return Math.min(1, Math.round(score * 100) / 100)
}
