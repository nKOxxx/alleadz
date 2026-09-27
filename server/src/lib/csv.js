// server/src/lib/csv.js — zero-dependency RFC4180 CSV parser.
// Handles quoted fields, escaped quotes (""), CRLF, trailing newline.
// Deliberately strict about column count consistency per file.

/**
 * Parse CSV text -> { headers: string[], rows: Array<{row_number, values: string[]}> }
 * Row numbers are 1-based data rows (header excluded).
 */
export function parseCsv(text) {
  const rows = []
  let field = ''
  let fields = []
  let inQuotes = false
  let started = false // have we produced any field content for this row
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
      started = true
    } else if (ch === ',') {
      fields.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (started || field !== '' || fields.length) {
        fields.push(field); field = ''
        rows.push(fields)
        fields = []
        started = false
      }
    } else {
      field += ch
      started = true
    }
  }
  if (field !== '' || fields.length || started) {
    fields.push(field)
    rows.push(fields)
  }
  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((h) => h.trim())
  const data = rows.slice(1)
    .filter((r) => !(r.length === 1 && r[0].trim() === '')) // skip blank lines
    .map((r, i) => ({ row_number: i + 1, values: r }))
  return { headers, rows: data }
}

/**
 * Apply a column map {csvColumn: canonicalField} to parsed rows.
 * Canonical fields: canonical_name, entity_type, domains, country, aliases, notes.
 * Returns per-row {ok, record?, error?}.
 */
const CANONICAL = ['canonical_name', 'entity_type', 'domains', 'country', 'aliases', 'notes']
const ENTITY_TYPES = new Set(['provider', 'buyer', 'partner', 'other'])

export function mapRows(parsed, columnMap) {
  const used = new Set(Object.keys(columnMap))
  return parsed.rows.map((r) => {
    const rec = {}
    const errs = []
    for (const [csvCol, canon] of Object.entries(columnMap)) {
      if (!CANONICAL.includes(canon)) continue
      const idx = parsed.headers.indexOf(csvCol)
      if (idx === -1) { errs.push(`column "${csvCol}" not found`); continue }
      const v = (r.values[idx] ?? '').trim()
      if (canon === 'domains' || canon === 'aliases') {
        if (v) rec[canon] = v.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
      } else if (v) {
        rec[canon] = v
      }
    }
    if (!rec.canonical_name) errs.push('canonical_name missing/empty')
    if (rec.entity_type && !ENTITY_TYPES.has(rec.entity_type.toLowerCase())) {
      errs.push(`entity_type "${rec.entity_type}" invalid`)
    } else if (rec.entity_type) {
      rec.entity_type = rec.entity_type.toLowerCase()
    }
    return errs.length
      ? { row_number: r.row_number, ok: false, error: errs.join('; ') }
      : { row_number: r.row_number, ok: true, record: rec }
  })
}

/** Suggest a column map from headers (best-effort auto-detect). */
export function suggestColumnMap(headers) {
  const lower = headers.map((h) => h.toLowerCase())
  const find = (...keys) => headers[lower.findIndex((h) => keys.some((k) => h.includes(k)))]
  const map = {}
  const name = find('name', 'company', 'organisation', 'organization')
  if (name) map[name] = 'canonical_name'
  const type = find('type', 'segment')
  if (type) map[type] = 'entity_type'
  const dom = find('domain', 'website', 'url', 'site')
  if (dom) map[dom] = 'domains'
  const country = find('country', 'geography', 'region')
  if (country) map[country] = 'country'
  const alias = find('alias', 'aka', 'also known')
  if (alias) map[alias] = 'aliases'
  const notes = find('note', 'comment')
  if (notes) map[notes] = 'notes'
  return map
}
