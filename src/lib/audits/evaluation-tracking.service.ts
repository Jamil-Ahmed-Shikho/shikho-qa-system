// ============================================================
// SHIKHO QA SYSTEM — evaluation-email click-through report (schema_092,
// 2026-10-12). Server-only. evaluation_tracking_report() is a SECURITY
// DEFINER function that does its own role/scope check — same shape as
// qa_rubric_fail_trends()/repeat_mistake_report().
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingEvaluationTrackingSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /evaluation_tracking_report|audit_result_views/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface EvaluationTrackingRow {
  auditId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  teamLeaderName: string | null
  auditorName: string | null
  submittedAt: string
  viewedAt: string | null
  viewCount: number
}

export async function loadEvaluationTrackingReport(
  from: Date, to: Date, view: QaRankingView = 'team'
): Promise<EvaluationTrackingRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('evaluation_tracking_report', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_view: view,
  })
  if (error) throw new Error(`Could not load the evaluation tracking report: ${error.message}`)
  return (data ?? []).map((r: {
    audit_id: string; agent_id: string; agent_name: string; team_name: string | null; site_name: string | null
    team_leader_name: string | null; auditor_name: string | null; submitted_at: string; viewed_at: string | null; view_count: number
  }) => ({
    auditId: r.audit_id, agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    teamLeaderName: r.team_leader_name, auditorName: r.auditor_name, submittedAt: r.submitted_at, viewedAt: r.viewed_at, viewCount: r.view_count,
  }))
}

/** How many days old, floored — used to decide "stale" styling and the Team Lead attention count. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}
