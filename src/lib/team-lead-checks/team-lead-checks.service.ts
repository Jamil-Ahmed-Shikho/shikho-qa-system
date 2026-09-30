// ============================================================
// SHIKHO QA SYSTEM — Team Leader Checks: results (schema_057)
// Server-only. RLS restricts who sees what: a Team Lead their own rows,
// Super Admin everything. A Manager NEVER gets row-level access — only a
// COUNT per Team Lead, via manager_tl_check_counts() (security definer).
// QA Manager / QA Auditor get nothing at all — no policy grants them rows.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export interface TeamLeadCheckRow {
  id: string
  agentId: string
  agentName: string
  teamLeadId: string
  teamLeadName: string
  crmLeadId: string | null
  callStartedAt: string | null
  notes: string | null
  createdAt: string
  answers: { checkTypeName: string; valueLabel: string }[]
}

async function withAnswers(supabase: Awaited<ReturnType<typeof getSupabaseServer>>, checks: {
  id: string; agent_id: string; team_lead_id: string; crm_lead_id: string | null; call_started_at: string | null; notes: string | null; created_at: string
}[]): Promise<TeamLeadCheckRow[]> {
  if (checks.length === 0) return []
  const ids = checks.map((c) => c.id)
  const userIds = [...new Set(checks.flatMap((c) => [c.agent_id, c.team_lead_id]))]
  const [{ data: answers, error: ansErr }, { data: users, error: usersErr }] = await Promise.all([
    supabase.from('team_lead_check_answers').select('team_lead_check_id, tl_check_types(name), tl_check_values(label)').in('team_lead_check_id', ids),
    supabase.from('users').select('id, name').in('id', userIds),
  ])
  if (ansErr) throw new Error(`Could not load check answers: ${ansErr.message}`)
  if (usersErr) throw new Error(`Could not load names: ${usersErr.message}`)
  const nameById = new Map((users ?? []).map((u) => [u.id, u.name]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnswerRow = { team_lead_check_id: string; tl_check_types: any; tl_check_values: any }
  const answersByCheck = new Map<string, { checkTypeName: string; valueLabel: string }[]>()
  for (const a of (answers ?? []) as AnswerRow[]) {
    const list = answersByCheck.get(a.team_lead_check_id) ?? []
    list.push({ checkTypeName: a.tl_check_types?.name ?? 'Unknown check', valueLabel: a.tl_check_values?.label ?? 'Unknown' })
    answersByCheck.set(a.team_lead_check_id, list)
  }
  return checks.map((c) => ({
    id: c.id, agentId: c.agent_id, agentName: nameById.get(c.agent_id) ?? 'Unknown',
    teamLeadId: c.team_lead_id, teamLeadName: nameById.get(c.team_lead_id) ?? 'Unknown',
    crmLeadId: c.crm_lead_id, callStartedAt: c.call_started_at, notes: c.notes, createdAt: c.created_at,
    answers: answersByCheck.get(c.id) ?? [],
  }))
}

/** A Team Lead's own checks (RLS scopes it to their own rows). */
export async function loadMyTeamLeadChecks(limit = 20): Promise<TeamLeadCheckRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('team_lead_checks').select('id, agent_id, team_lead_id, crm_lead_id, call_started_at, notes, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Could not load your checks: ${error.message}`)
  return withAnswers(supabase, data ?? [])
}

/** Super Admin only (RLS) — every check, for oversight. */
export async function loadAllTeamLeadChecks(limit = 100): Promise<TeamLeadCheckRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('team_lead_checks').select('id, agent_id, team_lead_id, crm_lead_id, call_started_at, notes, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Could not load Team Leader Checks: ${error.message}`)
  return withAnswers(supabase, data ?? [])
}

export interface ManagerTlCheckCount {
  teamLeadId: string
  teamLeadName: string
  checksCount: number
}

/** A Manager's lighter view: counts only, never the answers. */
export async function loadManagerTlCheckCounts(managerId: string, from: Date, to: Date): Promise<ManagerTlCheckCount[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('manager_tl_check_counts', { p_manager_id: managerId, p_from: from.toISOString(), p_to: to.toISOString() })
  if (error) throw new Error(`Could not load Team Leader Check counts: ${error.message}`)
  return (data ?? []).map((r: { team_lead_id: string; team_lead_name: string; checks_count: number }) => ({
    teamLeadId: r.team_lead_id, teamLeadName: r.team_lead_name, checksCount: r.checks_count,
  }))
}
