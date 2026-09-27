// server/src/db/migrate.js
// Applies pending migrations in filename order; records them in
// schema_migrations. Uses the SAME DATABASE_URL the app uses (Render managed
// Postgres: single role, DDL allowed for owner). Idempotent.

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

export async function migrate(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const client = new pg.Client({ connectionString, options: '-c search_path=alleadz,public' })
  await client.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
    const applied = new Set(
      (await client.query(`SELECT filename FROM schema_migrations`)).rows.map((r) => r.filename),
    )
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files) {
      if (applied.has(f)) continue
      const sql = readFileSync(join(dir, f), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [f])
        await client.query('COMMIT')
        console.log('applied', f)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${f} failed: ${err.message}`)
      }
    }
  } finally {
    await client.end()
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(
    () => process.exit(0),
    (err) => { console.error(err.message); process.exit(1) },
  )
}
