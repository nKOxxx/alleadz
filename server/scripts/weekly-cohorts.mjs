#!/usr/bin/env node
// scripts/weekly-cohorts.mjs — self-computed retention curves (Lieb law #9:
// "trust curves you computed yourself"). Reads ONLY the events table.
//
// Usage: DATABASE_URL="postgres://..." node scripts/weekly-cohorts.mjs
//
// Cohort = week of the tenant's first auth.registered event.
// Value action = first bundle.exported. Leading indicator = first signal.promoted.
// Prints one row per cohort week + an overall summary. No aggregates-only
// vanity numbers: every row is a curve point over time.

import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const pool = new pg.Client({
  connectionString: url,
  options: '-c search_path=alleadz,public', // shared-DB law: alleadz schema
})

const COHORTS_SQL = `
WITH reg AS (
  SELECT tenant_id, min(created_at) AS registered_at
    FROM events WHERE event_type = 'auth.registered'
   GROUP BY tenant_id
),
lead AS (
  SELECT tenant_id, min(created_at) AS first_promote
    FROM events WHERE event_type = 'signal.promoted'
   GROUP BY tenant_id
),
value AS (
  SELECT tenant_id, min(created_at) AS first_export
    FROM events WHERE event_type = 'bundle.exported'
   GROUP BY tenant_id
)
SELECT to_char(date_trunc('week', r.registered_at), 'YYYY-MM-DD') AS cohort_week,
       count(*)                                                   AS tenants,
       count(l.first_promote)                                     AS promoted,
       count(v.first_export)                                      AS exported,
       count(*) FILTER (WHERE v.first_export <= r.registered_at + interval '7 days')  AS exported_d7,
       count(*) FILTER (WHERE v.first_export <= r.registered_at + interval '30 days') AS exported_d30
  FROM reg r
  LEFT JOIN lead l  USING (tenant_id)
  LEFT JOIN value v USING (tenant_id)
 GROUP BY 1
 ORDER BY 1`

const FUNNEL_SQL = `
SELECT event_type, count(*) AS n, count(DISTINCT tenant_id) AS tenants
  FROM events
 GROUP BY event_type
 ORDER BY n DESC`

try {
  await pool.connect()
  const { rows } = await pool.query(COHORTS_SQL)
  const { rows: funnel } = await pool.query(FUNNEL_SQL)

  console.log('Weekly registration cohorts (value action = first bundle export)')
  console.log('cohort_week | tenants | promoted | exported | d7 | d30')
  console.log('------------+---------+----------+----------+----+----')
  if (!rows.length) console.log('(no registration events yet)')
  for (const r of rows) {
    const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')
    console.log(
      `${r.cohort_week} | ${String(r.tenants).padStart(7)} | ${String(r.promoted).padStart(8)} |` +
      ` ${String(r.exported).padStart(8)} | ${pct(r.exported_d7, r.tenants).padStart(2)} |` +
      ` ${pct(r.exported_d30, r.tenants).padStart(2)}`,
    )
  }
  console.log('\nEvent funnel (all time)')
  for (const f of funnel) {
    console.log(`  ${f.event_type.padEnd(18)} ${String(f.n).padStart(6)} events across ${f.tenants} tenant(s)`)
  }
} catch (err) {
  console.error(`cohort report failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
