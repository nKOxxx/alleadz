// server/src/middleware/auth.js
// requireAuth: bearer token -> req.user {id, emailVerified}.
// Generic 401 on every failure mode (never reveal malformed vs unknown).

import { verifySession } from '../auth/sessions.js'

const BEARER = /^Bearer\s+(.+)$/i

export function requireAuth({ pool } = {}) {
  return async function authGuard(req, res, next) {
    const match = BEARER.exec(req.headers.authorization || '')
    if (!match) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } })
      return
    }
    let session
    try {
      session = await verifySession(match[1], pool)
    } catch (err) {
      next(err)
      return
    }
    if (!session) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } })
      return
    }
    req.user = { id: session.userId, emailVerified: session.emailVerified }
    req.token = match[1]
    next()
  }
}

/**
 * requireTenant: resolves X-Tenant-Id against memberships and attaches
 * req.tenantId + req.roles. 400 missing header, 403 non-member / inactive.
 * Membership check runs withNoTenant (tenant_members has no RLS policy of its
 * own beyond FK integrity; the table is the trust anchor for RLS policies).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireTenant({ pool } = {}) {
  return async function tenantGuard(req, res, next) {
    const tenantId = req.headers['x-tenant-id']
    if (!tenantId || typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
      res.status(400).json({ error: { code: 'tenant_required', message: 'X-Tenant-Id header required' } })
      return
    }
    try {
      const { withNoTenant } = await import('../db/pool.js')
      const { rows } = await withNoTenant(pool, (c) =>
        c.query(
          `SELECT roles FROM tenant_members WHERE tenant_id = $1 AND user_id = $2 AND active`,
          [tenantId, req.user.id],
        ),
      )
      if (!rows.length) {
        res.status(403).json({ error: { code: 'forbidden', message: 'Not a member of this workspace' } })
        return
      }
      req.tenantId = tenantId
      req.roles = rows[0].roles || []
      next()
    } catch (err) {
      next(err)
    }
  }
}

export function requireRole(...allowed) {
  return function roleGuard(req, res, next) {
    if (!req.roles || !allowed.some((r) => req.roles.includes(r))) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Insufficient role' } })
      return
    }
    next()
  }
}
