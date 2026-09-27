// server/src/db/pool.js
// pg pool + RLS-scoped transaction helpers.
//
// Tenancy law: every tenant-scoped query runs inside withTenant(tenantId,
// userId, fn), which opens a transaction, SET LOCALs app.tenant_id +
// app.user_id (transaction-local GUCs), and runs fn(client). RLS policies
// (migrations/0001) read those GUCs. A query that forgets the helper simply
// sees no tenant rows — deny by default.
//
// App connects via DATABASE_URL (Render: sslmode require). Migration role
// separation is enforced operationally (migrations run with the owner URL);
// the app role has DML-only grants on tenant tables.

import pg from 'pg'

const { Pool, types } = pg
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // numeric -> number

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  let ssl
  try {
    const url = new URL(connectionString)
    const mode = url.searchParams.get('sslmode')
    if (mode === 'disable' || mode === 'allow' || mode === 'prefer') ssl = false
    else if (mode) ssl = { rejectUnauthorized: false } // require/verify-ca/verify-full: managed CA pinning not supported by node-pg; TLS still enforced
  } catch {
    /* non-URL connection string: let pg parse it */
  }
  return new Pool({
    connectionString,
    ssl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Shared-database mode: all Alleadz objects live in the `alleadz` schema
    // (free-tier Render allows one active Postgres). No-op if the schema is
    // absent (dedicated-DB mode). Set per-connection so RLS policies,
    // grants, and migrations all resolve inside alleadz.*.
    options: '-c search_path=alleadz,public',
  })
}

export const defaultPool = createPool()

/** Run fn(client) inside a tenant+user RLS context. Commits on success. */
export async function withTenant(pool, tenantId, userId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId])
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already closed */ }
    throw err
  } finally {
    client.release()
  }
}

/** Run fn(client) with NO tenant context (login, membership lookups). */
export async function withNoTenant(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already closed */ }
    throw err
  } finally {
    client.release()
  }
}

/**
 * Raw transaction with manual GUC control — for flows that CREATE a tenant
 * in the same transaction (registration), where the tenant id only exists
 * mid-transaction. fn(client, setLocal).
 */
export async function withTxn(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const setLocal = (key, value) =>
      client.query('SELECT set_config($1, $2, true)', [key, String(value)])
    const out = await fn(client, setLocal)
    await client.query('COMMIT')
    return out
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already closed */ }
    throw err
  } finally {
    client.release()
  }
}
