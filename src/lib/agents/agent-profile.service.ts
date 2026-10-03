// ============================================================
// SHIKHO QA SYSTEM — a QA-facing read of one agent's audit history (2026-10-03)
// Runs as the signed-in viewer, so RLS already scopes it: QA roles unrestricted,
// a Team Lead to their own team (team_agent_ids()), same as everywhere else —
// no new SECURITY DEFINER function needed, matching agent-dashboard.service.ts's
// own reasoning (it's already generic over agentId, just gated by the caller's RLS).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export interface AgentAuditHistoryItem {
  id: string
  submittedAt: string
  auditorName: string | null
  scorePercent: number | null
  passed: boolean | null
  criticalFail: boolean
}

export async function loadAgentAuditHistory(agentId: string): Promise<AgentAuditHistoryItem[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('audits')
    .select('id, submitted_at, score_percent, passed, critical_fail, auditor:users!audits_auditor_id_fkey(name)')
    .eq('agent_id', agentId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(`Could not load this agent's audit history: ${error.message}`)

  type Row = { id: string; submitted_at: string; score_percent: number | null; passed: boolean | null; critical_fail: boolean; auditor: { name: string } | { name: string }[] | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    submittedAt: r.submitted_at,
    auditorName: (Array.isArray(r.auditor) ? r.auditor[0]?.name : r.auditor?.name) ?? null,
    scorePercent: r.score_percent,
    passed: r.passed,
    criticalFail: r.critical_fail,
  }))
}
