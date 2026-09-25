// ============================================================
// Run the daily revenue sync ONCE, by hand, against the real CRM + database, and print
// what it did (before/after counts, the result, revenue_sync_state). Same code the cron
// runs (runDailyRevenueSync), so this is the way to confirm it after a change.
//   npx tsx --env-file=.env.local scripts/run-daily-sync.mts
// Costs ~6 CRM requests and writes to the database — not a loop, not for a schedule.
// ============================================================
import { runDailyRevenueSync } from '@/lib/revenue/sync-runner'
import { getSupabaseAdmin } from '@/lib/supabase/server'
const admin = getSupabaseAdmin()
const snap = async () => {
  const c = async (f: (q: any) => any) => { const { count, error } = await f(admin.from('agent_revenue_transactions').select('*', { count: 'exact', head: true })); if (error) throw error; return count }
  return { total: await c((q) => q), matched: await c((q) => q.not('agent_id', 'is', null)), flagged: await c((q) => q.not('missing_from_crm_since', 'is', null)) }
}
const users = await admin.from('users').select('id', { count: 'exact', head: true }).not('crm_agent_id', 'is', null)
console.log('BEFORE', JSON.stringify(await snap()), '| users with crm_agent_id:', users.count)
const t = Date.now()
const result = await runDailyRevenueSync()
console.log('RESULT', JSON.stringify(result, null, 1), `(${((Date.now() - t) / 1000).toFixed(1)}s)`)
console.log('AFTER ', JSON.stringify(await snap()))
const { data: st } = await admin.from('revenue_sync_state').select('*').eq('id', 'daily')
console.log('STATE', JSON.stringify(st))
const w = await admin.from('agent_weekly_sales').select('*', { count: 'exact', head: true })
const z = await admin.from('agent_zero_seller_status').select('*', { count: 'exact', head: true })
console.log('weekly sales rows:', w.count, '| zero-seller status rows:', z.count)
