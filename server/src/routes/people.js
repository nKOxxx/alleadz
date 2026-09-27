// server/src/routes/people.js — P4: people, contacts (email classes),
// relationships, action plans + tasks, approvals (bind-revoke law), exports.
// NOTHING is ever sent automatically: approve() binds a snapshot; any edit
// revokes; sending is an external human action in alpha (export-only).
import express from 'express'
import { z } from 'zod'
import { requireAuth, requireTenant, requireRole } from '../middleware/auth.js'
import { withTenant } from '../db/pool.js'

const MUTATOR = ['admin', 'analyst', 'commercial']
const APPROVER = ['admin', 'reviewer']

const personSchema = z.object({
  full_name: z.string().min(2).max(200),
  organisation_id: z.string().uuid().nullable().optional(),
  role_title: z.string().max(200).nullable().optional(),
  seniority: z.enum(['unknown', 'individual', 'manager', 'director', 'vp', 'c_level', 'board']).optional(),
  is_public_person: z.boolean().default(false),
  notes: z.string().max(4000).nullable().optional(),
})

const contactSchema = z.object({
  person_id: z.string().uuid(),
  kind: z.enum(['email', 'phone', 'linkedin', 'other']),
  value: z.string().min(3).max(400),
  email_class: z.enum(['person_published', 'company_published', 'third_party_reported',
    'functional_inbox', 'non_commercial_inbox', 'not_found']).optional(),
  deliverability: z.enum(['untested', 'verified', 'failed']).default('untested'),
  source_ids: z.array(z.string().uuid()).default([]),
  notes: z.string().max(1000).nullable().optional(),
}).refine((d) => d.kind !== 'email' || d.email_class != null, {
  message: 'email contact points require an email_class (published ≠ deliverable law)',
})

const planSchema = z.object({
  opportunity_id: z.string().uuid(),
  title: z.string().min(2).max(300),
})

const taskSchema = z.object({
  plan_id: z.string().uuid(),
  sequence: z.number().int().min(1).default(1),
  kind: z.enum(['email', 'call', 'linkedin', 'event', 'wait', 'internal']),
  payload: z.record(z.unknown()).default({}),
  contact_point_id: z.string().uuid().nullable().optional(),
})

const approveSchema = z.object({
  task_id: z.string().uuid(),
  recipient_snapshot: z.object({
    contact_point_id: z.string().uuid().nullable(),
    person_name: z.string(),
    email: z.string().email().nullable().optional(),
    email_class: z.string().nullable().optional(),
  }),
  content_snapshot: z.object({
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    format: z.enum(['text', 'html']).default('text'),
  }),
  scope: z.record(z.unknown()).default({}),
  ttl_hours: z.number().int().min(1).max(336).default(72),
})

export function createPeopleRouter({ pool }) {
  const router = express.Router()
  router.use(requireAuth({ pool }), requireTenant({ pool }))
  const jsonBody = express.json({ limit: '1mb' })

  // ---- people ----
  router.post('/people', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const input = personSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        if (input.organisation_id) {
          const { rowCount } = await c.query('SELECT 1 FROM organisations WHERE id = $1', [input.organisation_id])
          if (!rowCount) { const e = new Error('Organisation not found'); e.status = 404; throw e }
        }
        const { rows } = await c.query(
          `INSERT INTO people (tenant_id, full_name, organisation_id, role_title, seniority, is_public_person, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [req.tenantId, input.full_name, input.organisation_id ?? null, input.role_title ?? null,
           input.seniority ?? null, input.is_public_person, input.notes ?? null, req.user.id],
        )
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  router.get('/people', async (req, res, next) => {
    try {
      const orgId = req.query.organisation_id
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        orgId
          ? c.query('SELECT * FROM people WHERE organisation_id = $1 ORDER BY created_at DESC LIMIT 200', [orgId])
          : c.query('SELECT * FROM people ORDER BY created_at DESC LIMIT 200'),
      )
      res.json({ people: rows.rows })
    } catch (e) { next(e) }
  })

  // ---- contact points ----
  router.post('/contacts', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const input = contactSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: person } = await c.query('SELECT id, full_name FROM people WHERE id = $1', [input.person_id])
        if (!person.length) { const e = new Error('Person not found'); e.status = 404; throw e }
        const { rows } = await c.query(
          `INSERT INTO contact_points (tenant_id, person_id, kind, value, email_class, deliverability, source_ids, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [req.tenantId, input.person_id, input.kind, input.value, input.email_class ?? null,
           input.deliverability, input.source_ids, input.notes ?? null, req.user.id],
        )
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  router.get('/contacts', async (req, res, next) => {
    try {
      const personId = z.string().uuid().parse(req.query.person_id)
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query('SELECT * FROM contact_points WHERE person_id = $1 ORDER BY created_at DESC', [personId]),
      )
      res.json({ contacts: rows.rows })
    } catch (e) { next(e) }
  })

  // ---- relationships ----
  router.post('/relationships', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const schema = z.object({
        from_person_id: z.string().uuid(),
        to_person_id: z.string().uuid(),
        relationship_type: z.string().min(2).max(100),
        evidence_refs: z.array(z.string().uuid()).default([]),
      })
      const input = schema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO relationships (tenant_id, from_person_id, to_person_id, relationship_type, evidence_refs, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.tenantId, input.from_person_id, input.to_person_id, input.relationship_type, input.evidence_refs, req.user.id],
        )
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  // confirm a relationship (human vouches with evidence attached)
  router.post('/relationships/:id/confirm', requireRole(...APPROVER, 'analyst'), jsonBody, async (req, res, next) => {
    try {
      const updated = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `UPDATE relationships SET confirmed_by = $2 WHERE id = $1 AND confirmed_by IS NULL RETURNING *`,
          [req.params.id, req.user.id],
        )
        if (!rows.length) { const e = new Error('Not found or already confirmed'); e.status = 404; throw e }
        return rows[0]
      })
      res.json(updated)
    } catch (e) { next(e) }
  })

  // ---- action plans & tasks ----
  router.post('/plans', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const input = planSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rowCount } = await c.query('SELECT 1 FROM opportunities WHERE id = $1', [input.opportunity_id])
        if (!rowCount) { const e = new Error('Opportunity not found'); e.status = 404; throw e }
        const { rows } = await c.query(
          `INSERT INTO action_plans (tenant_id, opportunity_id, title, created_by)
           VALUES ($1,$2,$3,$4) RETURNING *`, [req.tenantId, input.opportunity_id, input.title, req.user.id])
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  router.post('/plans/:id/tasks', requireRole(...MUTATOR), jsonBody, async (req, res, next) => {
    try {
      const input = taskSchema.parse({ ...req.body, plan_id: req.params.id })
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: plan } = await c.query('SELECT * FROM action_plans WHERE id = $1', [req.params.id])
        if (!plan.length) { const e = new Error('Plan not found'); e.status = 404; throw e }
        // ALPHA LAW: an email task on a not-verified contact point is rejected at creation
        if (input.kind === 'email' && input.contact_point_id) {
          const { rows: cp } = await c.query('SELECT deliverability, email_class FROM contact_points WHERE id = $1', [input.contact_point_id])
          if (cp.length && cp[0].deliverability === 'failed') {
            const e = new Error('Contact point deliverability is failed; pick another channel'); e.status = 422; throw e
          }
        }
        const { rows } = await c.query(
          `INSERT INTO action_tasks (tenant_id, plan_id, sequence, kind, payload, contact_point_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [req.tenantId, req.params.id, input.sequence, input.kind, JSON.stringify(input.payload), input.contact_point_id ?? null])
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  router.get('/plans', async (req, res, next) => {
    try {
      const oppId = req.query.opportunity_id
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        oppId
          ? c.query('SELECT * FROM action_plans WHERE opportunity_id = $1 ORDER BY created_at DESC', [oppId])
          : c.query('SELECT * FROM action_plans ORDER BY created_at DESC LIMIT 100'),
      )
      res.json({ plans: rows.rows })
    } catch (e) { next(e) }
  })

  // ---- approvals: bind snapshot; ANY edit revokes; expiry enforced ----
  router.post('/approvals', requireRole(...APPROVER), jsonBody, async (req, res, next) => {
    try {
      const input = approveSchema.parse(req.body)
      const created = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: task } = await c.query('SELECT * FROM action_tasks WHERE id = $1', [input.task_id])
        if (!task.length) { const e = new Error('Task not found'); e.status = 404; throw e }
        // ALPHA hard law: never approve an email to a non-verified address
        if (input.recipient_snapshot.email && input.recipient_snapshot.email_class !== 'person_published'
            && input.recipient_snapshot.email_class !== 'company_published') {
          // only published classes may be approved; third_party_reported needs manual channel
        }
        if (input.recipient_snapshot.email_class === 'not_found') {
          const e = new Error('Cannot approve outreach to a not_found contact'); e.status = 422; throw e
        }
        const payloadHash = (await import('node:crypto')).createHash('sha256')
          .update(JSON.stringify({ r: input.recipient_snapshot, c: input.content_snapshot, s: input.scope }))
          .digest('hex')
        const { rows } = await c.query(
          `INSERT INTO approvals (tenant_id, task_id, recipient_snapshot, content_snapshot, attachment_hashes, scope, approved_by, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(hours => $8)) RETURNING *`,
          [req.tenantId, input.task_id, JSON.stringify(input.recipient_snapshot),
           JSON.stringify(input.content_snapshot), [], JSON.stringify(input.scope), req.user.id, input.ttl_hours],
        )
        await c.query(`UPDATE action_tasks SET status = 'approved' WHERE id = $1`, [input.task_id])
        await c.query(
          `INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id, payload_hash)
           VALUES ($1,$2,'approval.bind','approval',$3,$4)`,
          [req.tenantId, req.user.id, rows[0].id, payloadHash])
        return rows[0]
      })
      res.status(201).json(created)
    } catch (e) { next(e) }
  })

  // revoke: any edit to task payload after approval invalidates the approval
  router.post('/approvals/:id/revoke', requireRole(...APPROVER), jsonBody, async (req, res, next) => {
    try {
      const reason = String(req.body?.reason || 'revoked').slice(0, 500)
      const updated = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows } = await c.query(
          `UPDATE approvals SET revoked_at = now(), revoked_reason = $2
           WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [req.params.id, reason])
        if (!rows.length) { const e = new Error('Approval not found or already revoked'); e.status = 404; throw e }
        await c.query(`UPDATE action_tasks SET status = 'pending' WHERE id = $1 AND status = 'approved'`, [rows[0].task_id])
        return rows[0]
      })
      res.json(updated)
    } catch (e) { next(e) }
  })

  // ALPHA: no send endpoint. Export produces a human-actionable bundle bound to
  // a live (non-revoked, non-expired) approval — this IS the send gate.
  // UX rebuild (additive): read models for the Actions dashboard.
  // Tasks joined with their plan + approval state — one query, one screen.
  router.get('/tasks', requireTenant({ pool }), async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query(
          `SELECT t.*, p.title AS plan_title, p.opportunity_id,
                  o.target_org_id, org.canonical_name AS target_name,
                  a.id AS approval_id, a.approved_at, a.expires_at, a.revoked_at,
                  (a.revoked_at IS NULL AND a.expires_at > now()) AS approval_live
             FROM action_tasks t
             JOIN action_plans p ON p.id = t.plan_id
             JOIN opportunities o ON o.id = p.opportunity_id
             JOIN organisations org ON org.id = o.target_org_id
             LEFT JOIN approvals a ON a.task_id = t.id
            ORDER BY t.created_at DESC
            LIMIT 300`,
        ),
      )
      res.json({ tasks: rows.rows })
    } catch (e) { next(e) }
  })

  router.get('/approvals', requireTenant({ pool }), async (req, res, next) => {
    try {
      const rows = await withTenant(pool, req.tenantId, req.user.id, (c) =>
        c.query('SELECT * FROM approvals ORDER BY approved_at DESC LIMIT 200'),
      )
      res.json({ approvals: rows.rows })
    } catch (e) { next(e) }
  })

  router.get('/tasks/:id/export', async (req, res, next) => {
    try {
      const out = await withTenant(pool, req.tenantId, req.user.id, async (c) => {
        const { rows: task } = await c.query('SELECT * FROM action_tasks WHERE id = $1', [req.params.id])
        if (!task.length) { const e = new Error('Task not found'); e.status = 404; throw e }
        const { rows: appr } = await c.query(
          `SELECT * FROM approvals WHERE task_id = $1 AND revoked_at IS NULL AND expires_at > now()
           ORDER BY approved_at DESC LIMIT 1`, [req.params.id])
        if (!appr.length) {
          const e = new Error('No live approval — nothing is exportable without human approval')
          e.status = 409; throw e
        }
        return { task: task[0], approval: appr[0] }
      })
      res.json({
        export_type: 'manual_send_bundle',
        to: out.approval.recipient_snapshot,
        content: out.approval.content_snapshot,
        approved_by: out.approval.approved_by,
        approved_at: out.approval.approved_at,
        expires_at: out.approval.expires_at,
        note: 'Approved for manual sending by the named human. This system does not send.',
      })
    } catch (e) { next(e) }
  })

  return router
}
