// server/test/helpers.js
// Scratch-database harness: one temp DB per test FILE (fast + isolated).
// Skips cleanly when DATABASE_URL is absent (pure-unit CI run stays green).

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import pg from 'pg'
import { migrate } from '../src/db/migrate.js'

const LOCAL_SOCKET = '/tmp/.s.PGSQL.5432'
const LOCAL_BASE = 'postgresql:///postgres?host=/tmp'

/**
 * Admin connection for CREATE/DROP DATABASE. Preference order:
 *  1. ALLEADZ_TEST_DB_URL (explicit override)
 *  2. local socket (fast, used by every dev/test run on this machine)
 *  3. DATABASE_URL (remote — slow; works but integration suites may need
 *     raised timeouts)
 */
export function databaseUrl() {
  if (process.env.ALLEADZ_TEST_DB_URL) return process.env.ALLEADZ_TEST_DB_URL
  if (existsSync(LOCAL_SOCKET)) return LOCAL_BASE
  return process.env.DATABASE_URL || ''
}

export function usingRealDatabase() {
  return Boolean(databaseUrl())
}

/**
 * Creates a uniquely-named scratch database, migrates it, hands back a pool
 * + the app factory bound to it. cleanup() drops it.
 */
export async function createScratchDb() {
  const admin = new pg.Client({ connectionString: databaseUrl() })
  await admin.connect()
  const dbName = `alleadz_test_${randomBytes(6).toString('hex')}` // safe identifier chars only
  await admin.query(`CREATE DATABASE ${dbName}`)
  const url = new URL(databaseUrl())
  url.pathname = `/${dbName}`
  const ownerUrl = url.toString()

  // Migrations run as the OWNER role (DDL), like prod.
  await migrate(ownerUrl)

  let appUrl = ownerUrl
  const useLocalRole = !process.env.ALLEADZ_TEST_DB_URL && existsSync(LOCAL_SOCKET)
  if (useLocalRole) {
    // Model prod role separation (SECURITY_BASELINE #7): the APP connects as a
    // dedicated non-superuser role so FORCE RLS actually bites. (Superusers
    // bypass even FORCE RLS — connecting tests as the owner would prove nothing.)
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'alleadz_app') THEN
           CREATE ROLE alleadz_app LOGIN PASSWORD 'alleadz_test_only' NOSUPERUSER NOBYPASSRLS;
         END IF;
       END $$`,
    )
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO alleadz_app`)
    const owner = new pg.Client({ connectionString: ownerUrl })
    await owner.connect()
    try {
      const me = (await owner.query('SELECT current_user AS u')).rows[0].u
      await owner.query(`GRANT USAGE ON SCHEMA public TO alleadz_app`)
      await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alleadz_app`)
      await owner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public FOR ROLE ${me}
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alleadz_app`,
      )
    } finally {
      await owner.end()
    }
    const u = new URL(ownerUrl)
    // NOTE: WHATWG URL silently drops userinfo for non-special schemes like
    // `postgresql:` (empty host), so we do NOT use u.username/u.password here —
    // we build the libpq string directly. The test password is ASCII-safe.
    appUrl = `postgresql://alleadz_app:alleadz_test_only@/${dbName}?host=/tmp`
  }

  const { createPool } = await import('../src/db/pool.js')
  const pool = createPool(appUrl)
  const { createApp } = await import('../src/app.js')

  return {
    pool,
    createApp: (opts = {}) => createApp({ pool, ...opts }),
    async cleanup() {
      await pool.end()
      const c = new pg.Client({ connectionString: databaseUrl() })
      await c.connect()
      await c.query(`DROP DATABASE IF EXISTS ${dbName}`)
      await c.end()
    },
  }
}

/** Register a user (+workspace), return {token, userId, tenantId, email}. */
export async function registerUser(base, email, workspaceName = 'WS') {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', workspaceName }),
  })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return { token: body.token, userId: body.user.id, tenantId: body.tenant.id, email }
}

/** Convenience JSON fetch with bearer + tenant headers. Paths are /api-relative. */
export function api(base, { method = 'GET', path, token, tenantId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId) headers['X-Tenant-Id'] = tenantId
  const url = `${base}/api${path.startsWith('/api') ? path.slice(4) : path}`
  return fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }))
}

/** Raw SQL as a specific tenant (sets RLS GUCs). For test assertions only. */
export async function queryAsTenant(pool, tenantId, userId, sql, params = []) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId])
    const out = await client.query(sql, params)
    await client.query('COMMIT')
    return out
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    throw e
  } finally {
    client.release()
  }
}
