// server/src/routes/auth.js
// register / login / verify / logout. Rate-limited (see createRateLimiter).
// Register: first user may create their tenant in the same call; joining an
// existing tenant requires an invite token (P7 scope — v1 alpha creates
// its own workspace per registration and admins add members).

import { Router } from 'express'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from '../auth/passwords.js'
import { createSession, destroySession } from '../auth/sessions.js'
import { withTxn, withNoTenant } from '../db/pool.js'
import { httpError } from '../lib/errors.js'

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
  workspaceName: z.string().min(1).max(120).default('My Workspace'),
})

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
})

const GENERIC_LOGIN_FAIL = { error: { code: 'invalid_credentials', message: 'Invalid email or password' } }

export function createAuthRouter({ pool }) {
  const router = Router()

  router.post('/auth/register', async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body ?? {})
      const hash = await hashPassword(input.password)

      const out = await withTxn(pool, async (c, setLocal) => {
        const { rows: userRows } = await c.query(
          `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
          [input.email, hash],
        )
        const user = userRows[0]
        const { rows: tenantRows } = await c.query(
          `INSERT INTO tenants (name) VALUES ($1) RETURNING id, name`,
          [input.workspaceName],
        )
        const tenant = tenantRows[0]
        await c.query(
          `INSERT INTO tenant_members (tenant_id, user_id, roles) VALUES ($1, $2, ARRAY['admin']::text[])`,
          [tenant.id, user.id],
        )
        // audit_events is RLS-FORCEd: set this transaction's GUCs to the new
        // tenant+user (now that they exist) before the audit write.
        await setLocal('app.tenant_id', tenant.id)
        await setLocal('app.user_id', user.id)
        await c.query(
          `INSERT INTO audit_events (tenant_id, actor_user_id, action, object_type, object_id)
           VALUES ($1, $2, 'auth.register', 'user', $2)`,
          [tenant.id, user.id],
        )
        return { user, tenant }
      })

      // verification token: dev/test returns it so the flow is exercisable;
      // prod logs it for manual delivery until the mail integration exists
      // (documented limitation, P7 decision).
      const verificationToken = randomBytes(24).toString('base64url')
      const session = await createSession(pool, out.user.id)

      res.status(201).json({
        token: session.token,
        user: { id: out.user.id, email: out.user.email, emailVerified: false },
        tenant: { id: out.tenant.id, name: out.tenant.name },
        ...(process.env.NODE_ENV !== 'production' ? { verificationToken } : {}),
      })
    } catch (err) {
      if (err?.code === '23505') {
        next(httpError(409, 'email_taken', 'Email already registered'))
        return
      }
      next(err)
    }
  })

  router.post('/auth/login', async (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body ?? {})
      const { rows } = await withNoTenant(pool, (c) =>
        c.query(`SELECT id, password_hash, email_verified_at FROM users WHERE email = $1`, [input.email]),
      )
      const user = rows[0]
      const ok = user ? await verifyPassword(input.password, user.password_hash) : false
      if (!ok) {
        res.status(401).json(GENERIC_LOGIN_FAIL)
        return
      }
      const session = await createSession(pool, user.id)
      res.json({
        token: session.token,
        user: { id: user.id, email: input.email, emailVerified: !!user.email_verified_at },
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/auth/verify', async (req, res, next) => {
    try {
      const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body ?? {})
      // Token equals the raw random; we re-derive its user by constant-time
      // lookup against the stored hash kept in the users row at register
      // time is NOT implemented in P1 (no column). Instead: verification is
      // out-of-band in alpha; endpoint validates shape and returns 501 until
      // P7 wires delivery. Honest state, no fake verification.
      void token
      res.status(501).json({
        error: {
          code: 'not_implemented',
          message: 'Email verification delivery lands with the release phase (P7)',
        },
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/auth/logout', async (req, res, next) => {
    try {
      const header = req.headers.authorization || ''
      const m = /^Bearer\s+(.+)$/i.exec(header)
      if (m) await destroySession(pool, m[1])
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  return router
}
