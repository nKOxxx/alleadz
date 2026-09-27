// server/src/routes/imports.js — CSV import: upload/parse/preview, commit, reject.
// LAW: originals retained forever (import_rows raw); commits are idempotent
// per import; merges are reviewer actions (see /merge), never automatic.
import express from 'express'
import { z } from 'zod'
import { parseCsv, mapRows, suggestColumnMap } from '../lib/csv.js'
import { classify } from '../lib/reconcile.js'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'

const IMPORT_LIMIT = { maxRows: 5000, maxBytes: 4_000_000 }

const commitSchema = z.object({
  import_id: z.string().uuid(),
  column_map: z.record(z.string()).default({}),
})

const mergeSchema = z.object({
  survivor_org_id: z.string().uuid(),
  merged_org_id: z.string().uuid(),
  note: z.string().max(2000).optional(),
})

export function createImportsRouter({ pool }) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))
  const jsonBody = express.json({ limit: '6mb' })

  // POST /imports/preview — body: {filename, csv_text}
  router.post('/imports/preview', requireRole('admin', 'analyst', 'commercial'), jsonBody, async (req, res, next) => {
    try {
      const { tenantId } = req
      const userId = req.user.id
      const filename = String(req.body?.filename || 'upload.csv').slice(0, 200)
      const csvText = String(req.body?.csv_text || '')
      const buf = Buffer.from(csvText, 'utf8')
      if (buf.length > IMPORT_LIMIT.maxBytes) {
        return res.status(413).json({ error: { code: 'too_large', message: 'File exceeds 4 MB limit' } })
      }
      const parsed = parseCsv(csvText)
      if (!parsed.headers.length) {
        return res.status(400).json({ error: { code: 'empty', message: 'No header row found' } })
      }
      if (parsed.rows.length > IMPORT_LIMIT.maxRows) {
        return res.status(413).json({ error: { code: 'too_many_rows', message: `Max ${IMPORT_LIMIT.maxRows} rows` } })
      }
      const columnMap = req.body?.column_map && Object.keys(req.body.column_map).length
        ? req.body.column_map
        : suggestColumnMap(parsed.headers)
      const mapped = mapRows(parsed, columnMap)
      const okRows = mapped.filter((m) => m.ok)

      // classify against existing orgs (single query) + batch-internal seen-set
      const { rows: existingOrgs } = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query('SELECT id, canonical_name, domains FROM organisations'),
      )
      const batchSeen = new Map()
      const classifications = okRows.map((m) => {
        const cls = classify(m.record, existingOrgs, batchSeen)
        if (cls.kind === 'new' && m.record.canonical_name) {
          batchSeen.set(m.record.canonical_name.toLowerCase().replace(/[^a-z0-9]/g, ''), null)
        }
        return cls
      })

      // store the import + rows for later commit (status pending_review)
      const importId = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const ins = await c.query(
          `INSERT INTO imports (tenant_id, filename, uploaded_by, column_map, row_count)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [tenantId, filename, userId, JSON.stringify(columnMap), parsed.rows.length],
        )
        const impId = ins.rows[0].id
        for (let i = 0; i < mapped.length; i++) {
          const m = mapped[i]
          const cls = classifications[i] || { kind: 'new' }
          await c.query(
            `INSERT INTO import_rows (import_id, tenant_id, row_number, raw, parse_status, parse_error, created_org_id, duplicate_of_org_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [impId, tenantId, m.row_number, JSON.stringify(m.record || m), m.ok ? 'ok' : 'error', m.ok ? null : m.error,
             null, // created_org_id set on commit
             cls.kind === 'duplicate' ? cls.of_org_id : null],
          )
        }
        return impId
      })

      res.json({
        import_id: importId,
        suggested_column_map: columnMap,
        total: mapped.length,
        valid: okRows.length,
        errors: mapped.filter((m) => !m.ok).slice(0, 100).map((m) => ({ row_number: m.row_number, error: m.error })),
        duplicates: classifications
          .map((c, i) => (c.kind === 'duplicate' ? { row_number: okRows[i].row_number, of_org_id: c.of_org_id, reason: c.reason } : null))
          .filter(Boolean),
        candidates: classifications
          .map((c, i) => (c.kind === 'candidate' ? { row_number: okRows[i].row_number, reasons: c.reasons } : null))
          .filter(Boolean),
      })
    } catch (e) { next(e) }
  })

  // POST /imports/commit — body: {import_id, column_map}. Creates orgs for rows
  // that parse OK and are not duplicates; candidates are created too but a
  // research_task notes the similarity. Research queue rows for errors too.
  router.post('/imports/commit', requireRole('admin', 'analyst', 'commercial'), jsonBody, async (req, res, next) => {
    try {
      const { tenantId } = req
      const userId = req.user.id
      const input = commitSchema.parse(req.body)
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: impRows } = await c.query(
          `SELECT id, status, column_map FROM imports WHERE id = $1 FOR UPDATE`,
          [input.import_id],
        )
        if (!impRows.length) { const e = new Error('Import not found'); e.status = 404; throw e }
        const imp = impRows[0]
        if (imp.status !== 'pending_review') {
          const e = new Error(`Import already ${imp.status}`); e.status = 409; throw e
        }
        const map = Object.keys(input.column_map).length ? input.column_map : imp.column_map
        const { rows: rawRows } = await c.query(
          `SELECT id, row_number, raw, parse_status FROM import_rows WHERE import_id = $1 ORDER BY row_number`,
          [imp.id],
        )
        let created = 0, dupes = 0, candidates = 0, failed = 0
        const researchIds = []
        const existing = await c.query('SELECT id, canonical_name, domains FROM organisations')
        const existingOrgs = existing.rows
        const batchSeen = new Map()
        for (const r of rawRows) {
          if (r.parse_status !== 'ok') {
            failed++
            const { rows: rt } = await c.query(
              `INSERT INTO research_tasks (tenant_id, import_row_id, reason, created_by)
               VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, r.id, `import row ${r.row_number}: parse error`, userId])
            researchIds.push(rt[0].id)
            continue
          }
          const rec = r.raw
          const cls = classify(rec, existingOrgs, batchSeen)
          if (cls.kind === 'duplicate') {
            dupes++
            await c.query(`UPDATE import_rows SET duplicate_of_org_id = $1 WHERE id = $2`, [cls.of_org_id, r.id])
            continue
          }
          const { rows: orgRows } = await c.query(
            `INSERT INTO organisations (tenant_id, canonical_name, entity_type, domains, aliases, notes)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [tenantId, rec.canonical_name, rec.entity_type || 'other', rec.domains || [], rec.aliases || [], rec.notes || null],
          )
          const orgId = orgRows[0].id
          created++
          await c.query(`UPDATE import_rows SET created_org_id = $1 WHERE id = $2`, [orgId, r.id])
          if (cls.kind === 'candidate') {
            candidates++
            const { rows: rt } = await c.query(
              `INSERT INTO research_tasks (tenant_id, organisation_id, import_row_id, reason, created_by)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [tenantId, orgId, r.id, `possible duplicate: ${cls.reasons.join('; ')}`, userId],
            )
            researchIds.push(rt[0].id)
          }
          existingOrgs.push({ id: orgId, canonical_name: rec.canonical_name, domains: rec.domains || [] })
        }
        await c.query(`UPDATE imports SET status = 'committed', committed_at = now() WHERE id = $1`, [imp.id])
        return { created, duplicates: dupes, candidates_marked: candidates, failed, research_task_ids: researchIds }
      })
      res.json(out)
    } catch (e) { next(e) }
  })

  // POST /imports/:id/reject
  router.post('/imports/:id/reject', requireRole('admin', 'analyst'), jsonBody, async (req, res, next) => {
    try {
      const note = String(req.body?.note || '').slice(0, 2000)
      const { rowCount } = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`UPDATE imports SET status = 'rejected', reject_note = $2 WHERE id = $1 AND status = 'pending_review'`,
          [req.params.id, note]),
      )
      if (!rowCount) { const e = new Error('Import not found or not pending'); e.status = 409; throw e }
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

  // POST /orgs/merge — reviewer-only; original rows retained via merges table.
  router.post('/orgs/merge', requireRole('admin', 'reviewer'), jsonBody, async (req, res, next) => {
    try {
      const input = mergeSchema.parse(req.body)
      if (input.survivor_org_id === input.merged_org_id) {
        return res.status(400).json({ error: { code: 'same_org', message: 'Cannot merge an organisation into itself' } })
      }
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `SELECT id FROM organisations WHERE id IN ($1,$2) FOR UPDATE`,
          [input.survivor_org_id, input.merged_org_id],
        )
        if (rows.length !== 2) { const e = new Error('Both organisations must exist in this workspace'); e.status = 404; throw e }
        await c.query(
          `INSERT INTO merges (tenant_id, survivor_org_id, merged_org_id, performed_by, note) VALUES ($1,$2,$3,$4,$5)`,
          [req.tenantId, input.survivor_org_id, input.merged_org_id, req.user.id, input.note || null],
        )
        await c.query(`UPDATE organisations SET merged_into_id = $1 WHERE id = $2`, [input.survivor_org_id, input.merged_org_id])
        return { ok: true }
      })
      res.json(out)
    } catch (e) { next(e) }
  })

  // GET /research — open research tasks
  router.get('/research', async (req, res, next) => {
    try {
      const { rows } = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT rt.id, rt.reason, rt.status, rt.organisation_id, rt.import_row_id, rt.created_at,
                  o.canonical_name
           FROM research_tasks rt LEFT JOIN organisations o ON o.id = rt.organisation_id
           WHERE rt.status = 'open' ORDER BY rt.created_at DESC LIMIT 200`,
        ),
      )
      res.json({ tasks: rows })
    } catch (e) { next(e) }
  })

  // POST /research/:id/resolve  body: {status: done|dismissed}
  router.post('/research/:id/resolve', requireRole('admin', 'analyst', 'reviewer'), jsonBody, async (req, res, next) => {
    try {
      const status = req.body?.status === 'dismissed' ? 'dismissed' : 'done'
      const { rowCount } = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(`UPDATE research_tasks SET status = $2, resolved_at = now() WHERE id = $1 AND status = 'open'`,
          [req.params.id, status]),
      )
      if (!rowCount) { const e = new Error('Task not found or already resolved'); e.status = 404; throw e }
      res.json({ ok: true })
    } catch (e) { next(e) }
  })

  return router
}

