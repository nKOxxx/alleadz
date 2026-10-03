#!/usr/bin/env node
// scripts/weekly-cohorts.mjs — self-computed retention curves (Lieb law #9:
// "trust curves you computed yourself"). Reads ONLY the events table.
//
// Usage: DATABASE_URL="postgres://..." node scripts/weekly-cohorts.mjs
//
// RLS LAW (learned 2026-10-03, first prod run): `events` is FORCE-RLS'd, so a
// bare owner connection sees ZERO rows. The report therefore enumerates
// tenants from `tenant_members` (the RLS trust anchor — intentionally has no
// denying policy) and reads each tenant's events INSIDE that tenant's GUC
// context. One transaction per tenant; per-tenant rows are aggregated in JS.
//
// Cohort = week of the tenant's first auth.registered event.
// Value action = first bundle.exported. Leading indicator = first signal.promoted.

import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString: url,
  options: '-c search_path=alleadz,public', // shared-DB law: alleadz schema
  max: 2,
})

// Enumerate (tenant, one member) pairs. tenant_members is the RLS trust
// anchor: no denying policy, readable without GUCs (requireTenant relies on
// exactly this via withNoTenant). No created_at column exists — order by
// user_id for determinism.
const TENANTS_SQL = `
SELECT DISTINCT ON (tenant_id) tenant_id, user_id
  FROM tenant_members
 WHERE active
 ORDER BY tenant_id, user_id ASC`

const TENANT_EVENTS_SQL = `
SELECT
  min(created_at) FILTER (WHERE event_type = 'auth.registered')   AS registered_at,
  min(created_at) FILTER (WHERE event_type = 'signal.promoted')   AS first_promote,
  min(created_at) FILTER (WHERE event_type = 'bundle.exported')   AS first_export,
  count(*) FILTER (WHERE event_type = 'auth.registered')          AS n_registered,
  count(*) FILTER (WHERE event_type = 'discovery.run')            AS n_discovery_run,
  count(*) FILTER (WHERE event_type = 'discovery.analyze')        AS n_analyze,
  count(*) FILTER (WHERE event_type = 'signal.promoted')          AS n_promoted,
  count(*) FILTER (WHERE event_type = 'bundle.exported')          AS n_exported
 FROM events`

const FUNNEL_COLUMNS = {
  'auth.registered': 'n_registered',
  'discovery.run': 'n_discovery_run',
  'discovery.analyze': 'n_analyze',
  'signal.promoted': 'n_promoted',
  'bundle.exported': 'n_exported',
}

function week(date) {
  const d = new Date(date)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86_400_000
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')

try {
  // ONE dedicated client for everything: GUC context and queries must share a
  // connection (pool.query may round-robin across clients — v2 bug), and the
  // client must be released or pool.end() deadlocks (v2 hang).
  const client = await pool.connect()
  try {
    const { rows: tenants } = await client.query(TENANTS_SQL)
    console.error(`context: ${tenants.length} tenant(s)`)

    const cohortRows = [] // {cohort_week, promoted, exported, d7, d30}
    const funnel = { 'auth.registered': 0, 'discovery.run': 0, 'discovery.analyze': 0, 'signal.promoted': 0, 'bundle.exported': 0 }

    let i = 0
    for (const t of tenants) {
      i++
      try {
        // ::text casts — parameterized set_config without a cast fails type
        // inference ("could not determine data type of parameter $1"); context
        // failures are FATAL, never warn-and-continue (24 silent misses taught us).
        await client.query(
          `SELECT set_config('app.tenant_id', $1::text, false), set_config('app.user_id', $2::text, false)`,
          [t.tenant_id, t.user_id],
        )
        const { rows } = await client.query(TENANT_EVENTS_SQL)
        const e = rows[0]
        for (const [type, col] of Object.entries(FUNNEL_COLUMNS)) funnel[type] += Number(e[col] ?? 0)
        if (e.registered_at) {
          cohortRows.push({
            cohort_week: week(e.registered_at),
            promoted: e.first_promote ? 1 : 0,
            exported: e.first_export ? 1 : 0,
            d7: e.first_export && daysBetween(e.registered_at, e.first_export) <= 7 ? 1 : 0,
            d30: e.first_export && daysBetween(e.registered_at, e.first_export) <= 30 ? 1 : 0,
          })
        }
      } catch (err) {
        console.warn(`tenant ${t.tenant_id}: read failed (non-fatal): ${err.message}`)
      }
    }
    console.error(`read: ${i}/${tenants.length} tenant(s) done`)
    await client.query(`SELECT set_config('app.tenant_id', '', false), set_config('app.user_id', '', false)`)

    // aggregate per-tenant rows into weekly cohorts
    const weeks = new Map()
    for (const r of cohortRows) {
      const w = weeks.get(r.cohort_week) ?? { tenants: 0, promoted: 0, exported: 0, d7: 0, d30: 0 }
      w.tenants++; w.promoted += r.promoted; w.exported += r.exported
      w.d7 += r.d7; w.d30 += r.d30
      weeks.set(r.cohort_week, w)
    }

    console.log('Weekly registration cohorts (value action = first bundle export)')
    console.log('cohort_week | tenants | promoted | exported |  d7 |  d30')
    console.log('------------+---------+----------+----------+-----+-----')
    if (!weeks.size) console.log('(no registration events yet)')
    for (const [wk, w] of [...weeks.entries()].sort()) {
      console.log(
        `${wk} | ${String(w.tenants).padStart(7)} | ${String(w.promoted).padStart(8)} |` +
        ` ${String(w.exported).padStart(8)} | ${pct(w.d7, w.tenants).padStart(3)} |` +
        ` ${pct(w.d30, w.tenants).padStart(3)}`,
      )
    }
    console.log('\nEvent funnel (all time, summed across tenants)')
    for (const [type, n] of Object.entries(funnel)) {
      console.log(`  ${type.padEnd(18)} ${String(n).padStart(6)} events`)
    }
  } finally {
    client.release()
  }
} catch (err) {
  console.error(`cohort report failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
