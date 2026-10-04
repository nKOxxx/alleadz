#!/usr/bin/env node
// server/scripts/snapshot-all.mjs — full logical snapshot of a FORCE-RLS database.
//
// pg_dump cannot read FORCE-RLS tables as the table owner (COPY is policy-filtered
// and pg_dump can't set GUCs), so snapshots walk tenants and set app.tenant_id /
// app.user_id per tenant — the same RLS-context law the cohort report follows.
// Round trips are the bottleneck (Oregon), so each tenant's tables come back as
// ONE jsonb bundle per tenant: 2 queries per tenant, not 2 per table per tenant.
//
// Usage: DATABASE_URL="$(cat /tmp/sg_render_ext.txt)" node scripts/snapshot-all.mjs [outDir]
// Output: <outDir>/<schema>.<table>.json + MANIFEST.json (row counts per table).

import fs from 'fs'
import path from 'path'
import pg from 'pg'

const OUT = process.argv[2] ?? path.join(process.cwd(), 'snapshot-out')
const cs = process.env.DATABASE_URL
if (!cs) { console.error('DATABASE_URL required'); process.exit(1) }
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const client = new pg.Client({ connectionString: cs })
await client.connect()

const { rows: schemata } = await client.query(
  `select schema_name from information_schema.schemata
   where schema_name not like 'pg_%' and schema_name <> 'information_schema'`,
)

fs.mkdirSync(OUT, { recursive: true })

// ---------- tenant->admin map (built once) ----------
const { rows: tenantRows } = await client.query(`select id from alleadz.tenants`)
const tenantAdmins = []
for (const t of tenantRows) {
  const { rows: members } = await client.query(
    `select user_id from alleadz.tenant_members where tenant_id = $1 limit 1`, [t.id],
  )
  if (members[0]?.user_id) tenantAdmins.push({ id: t.id, uid: members[0].user_id })
}
console.log(`tenants with admin context: ${tenantAdmins.length}`)

// ---------- classify tables ----------
const bucket = { tenant: {}, bare: {} } // schema.table -> columns
for (const { schema_name: schema } of schemata) {
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = $1 and table_type = 'BASE TABLE' order by table_name`,
    [schema],
  )
  for (const { table_name: table } of tables) {
    const { rows: cols } = await client.query(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = $2 order by ordinal_position`, [schema, table],
    )
    const names = cols.map((c) => c.column_name)
    const key = `${schema}.${table}`
    if (names.includes('tenant_id') && schema === 'alleadz' && table !== 'tenants' && table !== 'tenant_members') {
      bucket.tenant[key] = names
    } else {
      bucket.bare[key] = names
    }
  }
}
const tenantTables = Object.keys(bucket.tenant)
console.log(`tenant-scoped tables: ${tenantTables.length}; bare: ${Object.keys(bucket.bare).length}`)

// ---------- data ----------
const data = {} // key -> rows
let total = 0

// bare tables: one query each
for (const key of Object.keys(bucket.bare)) {
  const rows = (await client.query(`select * from ${key}`)).rows
  data[key] = rows
  total += rows.length
  console.log(`${key}: ${rows.length}`)
}

// tenant tables: 2 queries per tenant (GUCs + jsonb bundle of ALL tenant tables)
for (const { id, uid } of tenantAdmins) {
  if (!isUuid(id) || !isUuid(uid)) throw new Error(`bad uuid for tenant walk: ${id}`)
  await client.query(`select set_config('app.tenant_id', $1, false), set_config('app.user_id', $2, false)`, [id, uid])
  const selects = tenantTables
    .map((key) => `'${key}', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${key} t)`)
    .join(', ')
  const { rows } = await client.query(`select jsonb_build_object(${selects}) b`)
  for (const [key, arr] of Object.entries(rows[0].b)) {
    data[key] = (data[key] ?? []).concat(arr)
  }
}

// ---------- write ----------
const manifest = { generated_at: new Date().toISOString(), tables: {} }
for (const [key, rows] of Object.entries(data)) {
  fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(rows))
  manifest.tables[key] = rows.length
  total += rows.length
  console.log(`wrote ${key}: ${rows.length}`)
}
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify({ ...manifest, total }, null, 2))
console.log(`\nsnapshot complete: ${total} rows across ${Object.keys(data).length} tables -> ${OUT}`)
await client.end()
