// ============================================================
// Run one schema_XXX.sql migration file directly against the live database,
// wrapped in a single transaction so a failure partway through leaves nothing
// half-applied. Requires SUPABASE_DB_URL in .env.local (direct/session-pooler
// Postgres connection — the ordinary API keys can't run DDL).
//   node --env-file=.env.local scripts/run-migration.mjs supabase/schema_049_....sql
// ============================================================
import pg from 'pg'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/run-migration.mjs <path-to-migration.sql>')
  process.exit(1)
}
const sql = readFileSync(file, 'utf8')

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  console.log(`Applied ${file} successfully.`)
} catch (err) {
  await client.query('rollback')
  console.error(`FAILED — rolled back, nothing was applied. ${file}`)
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
