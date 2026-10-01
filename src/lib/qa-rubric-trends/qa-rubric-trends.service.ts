// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 6 (the last stage):
// rubric fail trends with analytics (§11). Server-only. The function does
// its own role check — super_admin/qa_manager (Team View, always) or
// qa_auditor (My View or Team View) — see schema_060.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingQaRubricTrendsSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_rubric_fail_trends/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface RubricFailTrendRow {
  parameterId: string
  parameterName: string
  categoryName: string
  rubricName: string
  totalScored: number
  totalFailed: number
  failRatePct: number
  priorFailRatePct: number | null
  trendPctPoints: number | null
}

export async function loadRubricFailTrends(from: Date, to: Date, view: QaRankingView = 'team'): Promise<RubricFailTrendRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_rubric_fail_trends', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load rubric fail trends: ${error.message}`)
  return (data ?? []).map((r: {
    parameter_id: string; parameter_name: string; category_name: string; rubric_name: string
    total_scored: number; total_failed: number; fail_rate_pct: number; prior_fail_rate_pct: number | null; trend_pct_points: number | null
  }) => ({
    parameterId: r.parameter_id, parameterName: r.parameter_name, categoryName: r.category_name, rubricName: r.rubric_name,
    totalScored: r.total_scored, totalFailed: r.total_failed, failRatePct: r.fail_rate_pct,
    priorFailRatePct: r.prior_fail_rate_pct, trendPctPoints: r.trend_pct_points,
  }))
}
