// server/src/auth/sessions.js
// Bearer sessions: 32 random bytes -> base64url token; DB stores sha256 only.
// 30-day expiry, sliding on use not implemented (keep simple/auditable).

import { createHash, randomBytes } from 'node:crypto'
import { withNoTenant } from '../db/pool.js'

const TTL_DAYS = 30

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(pool, userId) {
  const token = randomBytes(32).toString('base64url')
  const { rows } = await withNoTenant(pool, (c) =>
    c.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' days')::interval)
       RETURNING expires_at`,
      [hashToken(token), userId, String(TTL_DAYS)],
    ),
  )
  return { token, expiresAt: rows[0].expires_at }
}

/** Returns { userId } or null. Never throws on missing/expired. */
export async function verifySession(token, pool) {
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) return null
  const { rows } = await withNoTenant(pool, (c) =>
    c.query(
      `SELECT s.user_id, u.email_verified_at IS NOT NULL AS email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    ),
  )
  return rows[0] ? { userId: rows[0].user_id, emailVerified: rows[0].email_verified } : null
}

export async function destroySession(pool, token) {
  await withNoTenant(pool, (c) => c.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]))
}
