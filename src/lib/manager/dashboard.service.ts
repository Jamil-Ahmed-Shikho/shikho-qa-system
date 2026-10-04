// ============================================================
// SHIKHO QA SYSTEM — Manager dashboard data
// Server-only. Scoping is enforced in the database, not here:
//   - manager_agent_stats() (schema_007) only returns agents in the
//     requested manager's chain, and a caller can only request their
//     own chain unless they are super_admin / qa_manager;
//   - the users query below runs through RLS as the signed-in user.
// This file just shapes the results.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { describeRange, periodRange, type Period } from '@/lib/dates/sales-week'
import { loadQueue } from '@/lib/queue/queue.service'
import { buildRollup, type AgentStatRow, type ManagerRollup, type TeamLeadInfo } from './rollup'

export interface ManagerOption {
  id: string
  name: string
  role: 'manager' | 'qa_manager'
}

/** People whose reporting chain can be viewed (admins pick from this). */
export async function listManagerOptions(): Promise<ManagerOption[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role')
    .in('role', ['manager', 'qa_manager'])
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ManagerOption[]
}

export type ManagerDashboardResult =
  | { ok: true; managerName: string; rangeLabel: string; rollup: ManagerRollup }
  | { ok: false; error: string }

export async function getManagerDashboard(
  managerId: string,
  period: Period
): Promise<ManagerDashboardResult> {
  const supabase = await getSupabaseServer()
  const range = periodRange(period)

  const { data: manager } = await supabase.from('users').select('name').eq('id', managerId).maybeSingle()
  if (!manager) return { ok: false, error: 'That manager could not be found.' }

  const { data: teamLeads, error: tlError } = await supabase
    .from('users')
    .select('id, name, email, team_name, site_name, is_active')
    .eq('manager_id', managerId)
    .eq('role', 'team_lead')
    .order('name', { ascending: true })
  if (tlError) return { ok: false, error: tlError.message }

  const { data: rows, error: statsError } = await supabase.rpc('manager_agent_stats', {
    p_manager_id: managerId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  })
  if (statsError) {
    // Function missing => the schema_007 migration hasn't been run.
    if (statsError.code === 'PGRST202' || statsError.code === '42883') {
      return { ok: false, error: 'Manager reporting is not set up yet — run schema_007_manager_role.sql in the Supabase SQL Editor.' }
    }
    console.error('manager_agent_stats failed:', statsError)
    return { ok: false, error: 'Could not load performance data.' }
  }

  // bigint/numeric come back as numbers or numeric strings depending on
  // size — normalise so the rollup math is always on numbers.
  const agentRows: AgentStatRow[] = (rows ?? []).map((r: Record<string, unknown>) => ({
    agent_id: r.agent_id as string,
    agent_name: r.agent_name as string,
    agent_email: r.agent_email as string,
    team_name: (r.team_name as string | null) ?? null,
    site_name: (r.site_name as string | null) ?? null,
    employment_stage: r.employment_stage as string,
    is_active: r.is_active as boolean,
    team_leader_id: (r.team_leader_id as string | null) ?? null,
    audits_completed: Number(r.audits_completed),
    score_sum: Number(r.score_sum),
    audits_passed: Number(r.audits_passed),
    critical_fails: Number(r.critical_fails),
  }))

  // qa_agent_queue() (schema_070) — the same "right now" ranked view QA and Team Lead dashboards
  // use, scoped to THIS VIEWER's own session (manager_chain_ids() for an actual manager; unrestricted
  // for an admin browsing someone else's chain) — buildRollup() restricts it to this specific
  // manager's own agents (agentRows) regardless of which case applies. A failure here degrades
  // gracefully: the drill-down table just shows no ranked rows, the rest of the dashboard is unaffected.
  let queueRows: Awaited<ReturnType<typeof loadQueue>> = []
  try {
    queueRows = await loadQueue('team')
  } catch (err) {
    console.error('getManagerDashboard: loadQueue failed:', err)
  }

  return {
    ok: true,
    managerName: manager.name,
    rangeLabel: describeRange(range),
    rollup: buildRollup((teamLeads ?? []) as TeamLeadInfo[], agentRows, queueRows),
  }
}
