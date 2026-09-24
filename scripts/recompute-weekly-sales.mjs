#!/usr/bin/env node
// ============================================================
// Recompute weekly sales + Zero-Seller status (§6.3). LOCAL ONLY — reads
// and writes Supabase, never touches the CRM.
//
//   node --env-file=.env.local scripts/recompute-weekly-sales.mjs
//
// Same as running `select recompute_weekly_sales();` in the SQL editor
// (schema_022). Idempotent — safe to run any time, as often as you like,
// e.g. after a backfill run or after scripts/rematch-revenue.mjs --live.
// Afterwards:
//   select * from zero_seller_leaderboard;   -- longest streak first
//   select * from revenue_coverage;          -- how much revenue is attributed
// ============================================================
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const { data, error } = await supabase.rpc('recompute_weekly_sales')
if (error) {
  console.error('FATAL:', error.message)
  process.exit(1)
}
console.log(JSON.stringify(data, null, 2))
process.exit(0)
