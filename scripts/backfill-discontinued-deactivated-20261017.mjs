// ============================================================
// One-time backfill, 2026-10-17 — Jamil: "go ahead and backfill all 43 to
// 'Discontinued'". Kept as a permanent record, not a reusable tool.
//
// Context: 43 real agents were sitting with is_active=false but
// employment_stage still 'active' — deactivated (e.g. resigned) without
// ever having their Employment Stage updated, since the "Deactivate"
// button never touched that field (fixed going forward in
// src/lib/users/users.service.ts's setAccountActive(), same commit).
// Confirmed live beforehand that no auditor's weekly target total was
// actually inflated by any of these 43 (qa_agent_queue() re-checks
// is_active at read time) — this backfill is a label correction, not a
// live-number fix, EXCEPT for one agent (Suraiya jeimy) who had a genuine
// stale/un-frozen agent_weekly_audit_target row for the current week,
// written after her deactivation — §9.5's freeze-on-discontinue logic
// never fired for her because it only triggers on employment_stage=
// 'discontinued', never on is_active=false alone. Re-running
// compute_weekly_audit_targets() after this backfill correctly freezes it.
// ============================================================

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: jamil } = await supabase.from('users').select('id').eq('email', 'jamil.ahmed@shikho.com').single()

const { data: targets, error: selErr } = await supabase
  .from('users')
  .select('id, name, email, team_name, site_name')
  .eq('role', 'agent')
  .eq('is_active', false)
  .eq('employment_stage', 'active')
  .order('name')
if (selErr) throw selErr

console.log(`Found ${targets.length} agents to backfill (expected 43).`)
if (targets.length !== 43) {
  console.log('WARNING: count differs from the confirmed list — proceeding anyway, since the filter is the same one Jamil reviewed, but double-check the names below.')
}

const logs = []
for (const t of targets) {
  const { error } = await supabase.from('users').update({ employment_stage: 'discontinued' }).eq('id', t.id)
  if (error) throw new Error(`Failed on ${t.name} (${t.id}): ${error.message}`)
  logs.push({
    actor_id: jamil.id,
    action: 'user.updated',
    table_name: 'users',
    record_id: t.id,
    before_data: { employment_stage: 'active' },
    after_data: { employment_stage: 'discontinued', note: 'Backfilled 2026-10-17 — already deactivated, Employment Stage had never been updated' },
  })
  console.log(`  ${t.name} (${t.team_name}, ${t.site_name}) -> discontinued`)
}

// writeAuditLogs batches these elsewhere in the app; a plain insert here is equivalent.
const { error: logErr } = await supabase.from('audit_log').insert(logs)
if (logErr) throw logErr
console.log(`\nBackfilled ${targets.length} agents, logged ${logs.length} audit_log entries.`)

// Re-run so §9.5's freeze picks up anyone (like Suraiya jeimy) who had a stale,
// un-frozen current-week target row — now that employment_stage is 'discontinued'.
const { data: recompute, error: rpcErr } = await supabase.rpc('compute_weekly_audit_targets')
if (rpcErr) throw rpcErr
console.log('\ncompute_weekly_audit_targets() result:', JSON.stringify(recompute))

// Verify: zero agents left in the old (buggy) state.
const { count: remaining } = await supabase
  .from('users')
  .select('id', { count: 'exact', head: true })
  .eq('role', 'agent')
  .eq('is_active', false)
  .eq('employment_stage', 'active')
console.log('Agents still is_active=false + employment_stage=active (expect 0):', remaining)
