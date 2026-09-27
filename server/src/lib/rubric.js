// server/src/lib/rubric.js — deterministic scoring + hard checks. NO LLM.
// Weights per spec §9. rule_version bumps whenever scoring law changes.

export const RUBRIC_WEIGHTS = Object.freeze({
  fit: 35, trigger: 25, timing: 15, budget: 15, access: 10,
})
export const RUBRIC_DIMENSIONS = Object.freeze(Object.keys(RUBRIC_WEIGHTS))
export const RULE_VERSION = 'rubric-v1.1'

const STAGES = ['candidate', 'researching', 'thesis_ready', 'human_reviewed',
  'qualifying', 'qualified', 'handed_off', 'outcome_recorded']

/**
 * Hard constraint checks. Each returns {name, verdict: pass|fail|unknown, detail}.
 * Inputs come from twin_versions + claims only — deterministic.
 */
export function runHardChecks({ mandate, permittedMarkets = [], excludedMarkets = [],
  capabilities = [], targetClaims = {}, sectorType }) {
  const checks = []

  // mandate compatibility (text-level; unknown when either side missing)
  if (!mandate || !targetClaims.mandate_summary) {
    checks.push({ name: 'mandate', verdict: 'unknown', detail: 'mandate not stated on one or both sides' })
  } else {
    const m = mandate.toLowerCase()
    const t = String(targetClaims.mandate_summary).toLowerCase()
    const overlap = m.split(/\W+/).filter((w) => w.length > 3 && t.includes(w))
    checks.push({
      name: 'mandate',
      verdict: overlap.length ? 'pass' : 'unknown',
      detail: overlap.length ? `shared terms: ${overlap.slice(0, 5).join(', ')}` : 'no shared mandate terms (manual review needed)',
    })
  }

  // geography
  const targetCountry = targetClaims.country
  if (!targetCountry) {
    checks.push({ name: 'geography', verdict: 'unknown', detail: 'target country unverified' })
  } else if (excludedMarkets.some((m) => String(targetCountry).toLowerCase().includes(String(m).toLowerCase()))) {
    checks.push({ name: 'geography', verdict: 'fail', detail: `target country ${targetCountry} is excluded` })
  } else if (permittedMarkets.length === 0) {
    checks.push({ name: 'geography', verdict: 'pass', detail: 'no market restrictions' })
  } else if (permittedMarkets.some((m) => String(targetCountry).toLowerCase().includes(String(m).toLowerCase()))) {
    checks.push({ name: 'geography', verdict: 'pass', detail: `${targetCountry} within permitted markets` })
  } else {
    checks.push({ name: 'geography', verdict: 'unknown', detail: `${targetCountry} not explicitly permitted` })
  }

  // required capability (per sector pack; default: any evidenced capability)
  const required = {
    gpu_rental: 'GPU compute brokerage',
    gpu_hardware: 'GPU hardware supply',
    ai_colocation: 'Data centre capacity',
  }[sectorType]
  if (!required) {
    checks.push({ name: 'capability', verdict: 'unknown', detail: `no capability map for sector ${sectorType}` })
  } else {
    const cap = capabilities.find((c) => c.name === required)
    if (!cap) checks.push({ name: 'capability', verdict: 'fail', detail: `offering twin lacks "${required}"` })
    else if (cap.status === 'claimed') checks.push({ name: 'capability', verdict: 'unknown', detail: `"${required}" only claimed, not evidenced` })
    else checks.push({ name: 'capability', verdict: 'pass', detail: `"${required}" ${cap.status}` })
  }

  // disqualifiers (claim list)
  const dq = targetClaims.disqualifiers || []
  if (dq.length) checks.push({ name: 'disqualifiers', verdict: 'fail', detail: `target flagged: ${dq.join('; ')}` })
  else checks.push({ name: 'disqualifiers', verdict: 'pass', detail: 'none on record' })

  // procurement eligibility claim
  if (targetClaims.procurement_eligible === true) checks.push({ name: 'procurement', verdict: 'pass', detail: 'eligible per claim' })
  else if (targetClaims.procurement_eligible === false) checks.push({ name: 'procurement', verdict: 'fail', detail: 'ineligible per claim' })
  else checks.push({ name: 'procurement', verdict: 'unknown', detail: 'no procurement claim' })

  return checks
}

export function hardCheckSummary(checks) {
  const fails = checks.filter((c) => c.verdict === 'fail').map((c) => c.name)
  const unknowns = checks.filter((c) => c.verdict === 'unknown').map((c) => c.name)
  return {
    eligible_for_qualification: fails.length === 0 && unknowns.length === 0,
    failed: fails,
    unknown: unknowns,
  }
}

/**
 * Score. ratings = {dim: {rating: 0..4 | 'unknown', rationale, source_ids}}.
 * priority = Σ(w·r/4) over known dims; unknown contributes 0.
 * coverage = Σ(w over known dims) / Σ(all w), as 0..1.
 */
export function scoreOpportunity(ratings) {
  let priority = 0
  let knownWeight = 0
  const perDim = {}
  for (const dim of RUBRIC_DIMENSIONS) {
    const w = RUBRIC_WEIGHTS[dim]
    const r = ratings[dim]
    if (!r || r.rating === 'unknown' || typeof r.rating !== 'number') {
      perDim[dim] = { contribution: 0, known: false }
      continue
    }
    const clamped = Math.max(0, Math.min(4, r.rating))
    const contribution = (w * clamped) / 4
    priority += contribution
    knownWeight += w
    perDim[dim] = { contribution, known: true }
  }
  const coverage = knownWeight / 100
  return { priority: Math.round(priority * 1000) / 1000, coverage: Math.round(coverage * 1000) / 1000, perDim }
}

/**
 * Confidence per spec §9 initial rule.
 */
export function confidenceFor({ coverage, hardChecks, evidenceAgeDays, contradictions = [] }) {
  const missing = []
  const summary = hardCheckSummary(hardChecks)
  if (summary.unknown.length) missing.push(...summary.unknown.map((n) => `hard check unknown: ${n}`))
  if (summary.failed.length) missing.push(...summary.failed.map((n) => `hard check failed: ${n}`))
  if (contradictions.length) missing.push(`${contradictions.length} unresolved contradiction(s)`)

  if (summary.failed.length || contradictions.length) {
    return { confidence: 'low', missing_conditions: missing }
  }
  if (coverage < 0.6 || evidenceAgeDays > 90) {
    return { confidence: 'insufficient', missing_conditions: [...missing, coverage < 0.6 ? 'coverage < 60%' : 'evidence older than 90 days'] }
  }
  if (coverage < 0.8 || summary.unknown.length) {
    return { confidence: 'medium', missing_conditions: missing }
  }
  return { confidence: 'high', missing_conditions: [] }
}

/** Stage transition matrix (spec §10). */
export function canTransition(from, to) {
  if (from === to) return false
  // watch/rejected branches: reopenable to candidate
  if (from === 'watch' || from === 'rejected') return to === 'candidate'
  const i = STAGES.indexOf(from)
  const j = STAGES.indexOf(to)
  if (i === -1 || j === -1) return false
  return j === i + 1 // linear forward only; watch/rejected entered from any live stage below
}

export function canBranch(from, to) {
  if (to !== 'watch' && to !== 'rejected') return false
  return STAGES.includes(from) && from !== 'outcome_recorded'
}

export const LIVE_STAGES = STAGES
