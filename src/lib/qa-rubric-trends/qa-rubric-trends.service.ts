// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 6: rubric fail trends with
// analytics (§11). Server-only. The functions do their own role check —
// super_admin/qa_manager (Team View, always) or qa_auditor (My View or Team
// View) — see schema_060 (original) / schema_090 (channel filter, category
// rollup raw counts, weekly history — 2026-10-12).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import type { TeamName } from '@/types/database.types'

export function isMissingQaRubricTrendsSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_rubric_fail_trend|qa_parameter_coaching_list/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface RubricFailTrendRow {
  parameterId: string
  parameterName: string
  categoryId: string
  categoryName: string
  rubricName: string
  totalScored: number
  totalFailed: number
  failRatePct: number
  priorTotalScored: number
  priorTotalFailed: number
  priorFailRatePct: number | null
  trendPctPoints: number | null
}

/** null = every channel. */
export async function loadRubricFailTrends(
  from: Date, to: Date, view: QaRankingView = 'team', teamName: TeamName | null = null
): Promise<RubricFailTrendRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_rubric_fail_trends', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_view: view, p_team_name: teamName,
  })
  if (error) throw new Error(`Could not load rubric fail trends: ${error.message}`)
  return (data ?? []).map((r: {
    parameter_id: string; parameter_name: string; category_id: string; category_name: string; rubric_name: string
    total_scored: number; total_failed: number; fail_rate_pct: number
    prior_total_scored: number; prior_total_failed: number; prior_fail_rate_pct: number | null; trend_pct_points: number | null
  }) => ({
    parameterId: r.parameter_id, parameterName: r.parameter_name, categoryId: r.category_id, categoryName: r.category_name, rubricName: r.rubric_name,
    totalScored: r.total_scored, totalFailed: r.total_failed, failRatePct: r.fail_rate_pct,
    priorTotalScored: r.prior_total_scored, priorTotalFailed: r.prior_total_failed,
    priorFailRatePct: r.prior_fail_rate_pct, trendPctPoints: r.trend_pct_points,
  }))
}

export interface WeeklyFailPoint {
  parameterId: string
  weekStart: string
  totalScored: number
  totalFailed: number
  failRatePct: number
}

/** Trailing `weeks` sales weeks (Sat-Fri Dhaka), ending at the current (possibly in-progress) week —
 *  independent of the main period picker, since a sparkline needs enough history regardless of which
 *  single period is selected for the headline comparison. Sparse: a (parameter, week) with nothing
 *  scored that week has no row at all. */
export async function loadRubricFailTrendHistory(
  weeks: number, view: QaRankingView = 'team', teamName: TeamName | null = null
): Promise<WeeklyFailPoint[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_rubric_fail_trend_history', {
    p_weeks: weeks, p_view: view, p_team_name: teamName,
  })
  if (error) throw new Error(`Could not load rubric fail trend history: ${error.message}`)
  return (data ?? []).map((r: { parameter_id: string; week_start: string; total_scored: number; total_failed: number; fail_rate_pct: number }) => ({
    parameterId: r.parameter_id, weekStart: r.week_start, totalScored: r.total_scored, totalFailed: r.total_failed, failRatePct: r.fail_rate_pct,
  }))
}

export interface ParameterCoachingRow {
  parameterId: string
  agentId: string
  agentName: string
  teamLeaderName: string | null
  failCount: number
}

/** Every agent who failed ANY rubric parameter in the current sales week, for every parameter at
 *  once (schema_099) — "who needs coaching, on what" for the Rubric Fail Trends page's per-row
 *  expand. One call, not one per parameter, so expanding a row needs no further network round trip. */
export async function loadParameterCoachingList(
  view: QaRankingView = 'team', teamName: TeamName | null = null
): Promise<ParameterCoachingRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_parameter_coaching_list', { p_view: view, p_team_name: teamName })
  if (error) throw new Error(`Could not load the parameter coaching list: ${error.message}`)
  return (data ?? []).map((r: { parameter_id: string; agent_id: string; agent_name: string; team_leader_name: string | null; fail_count: number }) => ({
    parameterId: r.parameter_id, agentId: r.agent_id, agentName: r.agent_name, teamLeaderName: r.team_leader_name, failCount: r.fail_count,
  }))
}
