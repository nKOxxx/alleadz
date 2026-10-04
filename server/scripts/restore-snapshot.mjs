#!/usr/bin/env node
// server/scripts/restore-snapshot.mjs — restore a snapshot-all.mjs snapshot into a fresh DB.
//
// Companion to snapshot-all.mjs (the DB-migration data mover). Reads the JSON
// files + MANIFEST.json written by the snapshotter and re-inserts every row.
//
// RLS law: tenant-scoped tables (tenant_id column, alleadz schema, not
// tenants/tenant_members) are restored per-tenant with app.tenant_id /
// app.user_id session GUCs; FORCE-RLS would otherwise reject the inserts.
//
// FK law: tables are restored identity-chain-first then alphabetically, but FK
// graphs don't have to agree with alphabetical order (hit: action_plans →
// opportunities). Each table restores inside its own transaction; an FK
// violation defers the table to a later pass. A full pass with no progress is
// a hard failure naming the blocked tables. No session_replication_role tricks
// — that needs superuser and the real target's admin (Neon) doesn't have it.
//
// Usage: DATABASE_URL="<target>" node scripts/restore-snapshot.mjs <snapshotDir>
//   RESTORE_SCHEMA=alleadz   phase mode: only that schema's tables (co-tenant
//                            DBs restore one product at a time, right after
//                            that product's migrations run).

import fs from 'fs'
import path from 'path'
import pg from 'pg'

const DIR = process.argv[2]
if (!DIR || !fs.existsSync(path.join(DIR, 'MANIFEST.json'))) {
  console.error('usage: node scripts/restore-snapshot.mjs <snapshotDir>')
  process.exit(1)
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1) }
const ONLY_SCHEMA = process.env.RESTORE_SCHEMA ?? null
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

// Migration ledgers are LIVE truth, never data: the target's own `migrate`
// has already written its schema_migrations rows by the time this runs, and
// re-importing prod's ledger rows collides (23505) or lies about state.
const SKIP_TABLES = new Set(['alleadz.schema_migrations', 'public.schema_migrations', 'sg.schema_migrations'])

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8'))
const nonEmpty = Object.entries(manifest.tables)
  .filter(([k, n]) => n > 0 && !SKIP_TABLES.has(k))
  .map(([k]) => k)

const FIRST = ['alleadz.tenants', 'alleadz.users', 'alleadz.sessions', 'alleadz.tenant_members', 'sg.users', 'sg.sessions']
const ordered = [
  ...FIRST.filter((k) => nonEmpty.includes(k)),
  ...nonEmpty.filter((k) => !FIRST.includes(k)).sort(),
].filter((k) => !ONLY_SCHEMA || k.startsWith(`${ONLY_SCHEMA}.`))

// classify tenant-scoped tables exactly like the snapshotter
const scoped = new Set()
for (const key of ordered) {
  const [schema, table] = key.split('.')
  if (schema !== 'alleadz' || table === 'tenants' || table === 'tenant_members') continue
  const { rows } = await client.query(
    `select 1 from information_schema.columns
     where table_schema=$1 and table_name=$2 and column_name='tenant_id'`, [schema, table],
  )
  if (rows.length) scoped.add(key)
}

// payload cache: { key -> {cols, rows} }
const payloads = new Map()
for (const key of ordered) {
  const rows = JSON.parse(fs.readFileSync(path.join(DIR, `${key}.json`), 'utf8'))
  if (rows.length) payloads.set(key, { cols: Object.keys(rows[0]), rows })
}

// column-type cache: jsonb columns need explicit JSON.stringify — node-pg
// serializes JS arrays as Postgres ARRAY literals, and array-literal syntax
// is not valid JSON (hit: twin_versions.capabilities → 22P02).
const colTypes = new Map()
async function typesFor(key) {
  if (!colTypes.has(key)) {
    const [schema, table] = key.split('.')
    const { rows } = await client.query(
      `select column_name, data_type from information_schema.columns
       where table_schema=$1 and table_name=$2`, [schema, table],
    )
    colTypes.set(key, Object.fromEntries(rows.map((r) => [r.column_name, r.data_type])))
  }
  return colTypes.get(key)
}
const toJsonb = (types) => (c) => types[c]?.includes('json') // json | jsonb

async function restoreTable(key, { cols, rows }) {
  const types = await typesFor(key)
  const isJson = toJsonb(types)
  await client.query('BEGIN')
  try {
    const insertSql = `insert into ${key} (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`
    const paramsOf = (r) => cols.map((c) => (isJson(c) && r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]))
    if (scoped.has(key)) {
      const byTenant = new Map()
      for (const r of rows) {
        if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, [])
        byTenant.get(r.tenant_id).push(r)
      }
      for (const [tid, trows] of byTenant) {
        const { rows: members } = await client.query(
          `select user_id from alleadz.tenant_members where tenant_id = $1 limit 1`, [tid],
        )
        const uid = members[0]?.user_id
        if (!uid) throw new Error(`tenant ${tid} has no member context`)
        if (!isUuid(tid) || !isUuid(uid)) throw new Error(`bad uuid in ${key}: ${tid}`)
        await client.query(`select set_config('app.tenant_id', $1, false), set_config('app.user_id', $2, false)`, [tid, uid])
        for (const r of trows) {
          await client.query(insertSql, paramsOf(r))
        }
      }
    } else {
      for (const r of rows) {
        try {
          await client.query(insertSql, paramsOf(r))
        } catch (err) {
          err.message = `${key} row[${rows.indexOf(r)}] ${JSON.stringify(r).slice(0, 300)} :: ${err.message}`
          throw err
        }
      }
    }
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return false // FK: parent not restored yet — defer
    throw Object.assign(new Error(`${key}: ${err.message}`), { code: err.code })
  } finally {
    // session GUCs (is_local=false) persist past COMMIT — always clear
    await client.query(`select set_config('app.tenant_id', '', false), set_config('app.user_id', '', false)`).catch(() => {})
  }
}

const queue = ordered.map((key) => ({ key, passes: 0 }))
const counts = {}

while (queue.length) {
  let progressed = false
  for (const item of [...queue]) {
    const payload = payloads.get(item.key)
    if (!payload) { // empty table, nothing to insert
      counts[item.key] = 0
      queue.splice(queue.indexOf(item), 1)
      progressed = true
      console.log(`${item.key}: empty`)
      continue
    }
    const ok = await restoreTable(item.key, payload)
    if (ok) {
      counts[item.key] = payload.rows.length
      queue.splice(queue.indexOf(item), 1)
      progressed = true
      console.log(`${item.key}: ok (${payload.rows.length})`)
    } else {
      item.passes++ // FK parent not restored yet — retry next pass
    }
  }
  if (!progressed) break // nothing restored this pass -> remaining are FK-deadlocked
}

if (queue.length) {
  console.error(`\nFK-blocked tables (parents never restored): ${queue.map((q) => q.key).join(', ')}`)
  process.exit(2)
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`\nrestore complete: ${total} rows across ${Object.keys(counts).length} tables`)
await client.end()
