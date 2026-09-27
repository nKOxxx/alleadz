// server/src/lib/reconcile.js — entity resolution for imports.
// LAW: never auto-merge. Detect candidates; a reviewer decides.
// Duplicate detection keys, in order:
//   1. exact domain overlap (any shared domain)
//   2. normalized canonical_name equality (lowercase, strip legal suffixes/punct)

const LEGAL_SUFFIXES = /^(ltd|llc|inc|gmbh|bv|b v|s a|sa|limited|incorporated|corp|corporation|company|co|fz llc|fzc|dmcc|trading|holdings?)$/i

export function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !LEGAL_SUFFIXES.test(w))
    .join(' ')
    .trim()
}

/** Classify one incoming record against existing orgs + earlier rows in batch.
 * Returns {kind: 'duplicate', of_org_id, reason} | {kind: 'candidate', reasons[]} | {kind: 'new'} */
export function classify(record, existingOrgs, batchSeen) {
  const recDomains = (record.domains || []).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
  const recName = normalizeName(record.canonical_name)

  // exact domain hit = duplicate (deterministic)
  for (const org of existingOrgs) {
    const orgDomains = (org.domains || []).map((d) => d.toLowerCase())
    if (recDomains.some((d) => orgDomains.includes(d))) {
      return { kind: 'duplicate', of_org_id: org.id, reason: `domain match: ${recDomains.find((d) => orgDomains.includes(d))}` }
    }
  }
  // exact normalized name hit = duplicate
  for (const org of existingOrgs) {
    if (recName && normalizeName(org.canonical_name) === recName && recName !== '') {
      return { kind: 'duplicate', of_org_id: org.id, reason: `name match: ${org.canonical_name}` }
    }
  }
  // batch-internal dup (same import twice)
  const batch = batchSeen.get(recName)
  if (batch) return { kind: 'duplicate', of_org_id: batch, reason: 'duplicate within file' }

  // candidates = weaker signals: single-token name overlap, same-country no-name match is NOT enough
  const reasons = []
  for (const org of existingOrgs) {
    const orgName = normalizeName(org.canonical_name)
    if (recName && orgName && (recName.includes(orgName) || orgName.includes(recName))) {
      reasons.push(`similar name: "${org.canonical_name}"`)
    }
    if (recDomains.length && org.domains?.length) {
      const od = org.domains.map((d) => d.toLowerCase())
      const sharedTld = recDomains.some((d) => od.some((o) => d.split('.').slice(-1)[0] === o.split('.').slice(-1)[0]))
      if (sharedTld) reasons.push(`same tld as "${org.canonical_name}" (weak)`)
    }
  }
  return reasons.length ? { kind: 'candidate', reasons } : { kind: 'new' }
}
