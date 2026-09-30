// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 1: Auditor ranking (§11)
// Server-only. qa_auditor_ranking() and the coaching-target table both do
// their own role check (super_admin/qa_manager only) — see schema_050.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export interface AuditorRankingRow {
  auditorId: string
  auditorName: string
  agentsAssigned: number
  auditsDone: number
  auditTarget: number
  auditPct: number | null
  coachingCompleted: number
  coachingScheduled: number
  coachingTargetTotal: number | null
  coachingPct: number | null
  salesGrowthPct: number | null
  vintageTargetMetPct: number | null
  zeroSellerRecoveryPct: number | null
  pipRecoveryPct: number | null
  totalScore: number | null
}

export function isMissingQaRankingSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_auditor_ranking|qa_coaching_targets/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

function fromRow(r: {
  auditor_id: string; auditor_name: string; agents_assigned: number; audits_done: number; audit_target: number; audit_pct: number | null
  coaching_completed: number; coaching_scheduled: number; coaching_target_total: number | null; coaching_pct: number | null
  sales_growth_pct: number | null; vintage_target_met_pct: number | null; zero_seller_recovery_pct: number | null
  pip_recovery_pct: number | null; total_score: number | null
}): AuditorRankingRow {
  return {
    auditorId: r.auditor_id, auditorName: r.auditor_name, agentsAssigned: r.agents_assigned,
    auditsDone: r.audits_done, auditTarget: r.audit_target, auditPct: r.audit_pct,
    coachingCompleted: r.coaching_completed, coachingScheduled: r.coaching_scheduled,
    coachingTargetTotal: r.coaching_target_total, coachingPct: r.coaching_pct,
    salesGrowthPct: r.sales_growth_pct, vintageTargetMetPct: r.vintage_target_met_pct,
    zeroSellerRecoveryPct: r.zero_seller_recovery_pct, pipRecoveryPct: r.pip_recovery_pct,
    totalScore: r.total_score,
  }
}

export async function loadAuditorRanking(from: Date, to: Date): Promise<AuditorRankingRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_auditor_ranking', { p_from: from.toISOString(), p_to: to.toISOString() })
  if (error) throw new Error(`Could not load the auditor ranking: ${error.message}`)
  return (data ?? []).map(fromRow)
}

export async function loadCoachingTarget(): Promise<number | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('qa_coaching_targets').select('weekly_target').is('effective_to', null).maybeSingle()
  if (error) throw new Error(`Could not load the coaching target: ${error.message}`)
  return data?.weekly_target ?? null
}
