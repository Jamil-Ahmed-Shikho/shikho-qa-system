// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 1 (Auditor ranking) and
// Stage 2 (channel-wise audit progress) (§11). Server-only.
// qa_auditor_ranking() and qa_channel_progress() do their own role check —
// super_admin/qa_manager (Team View, always) or qa_auditor (My View or Team
// View, schema_052). The coaching-target table is QA-staff-only.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export type QaRankingView = 'mine' | 'team'

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
  return /qa_auditor_ranking|qa_coaching_targets|qa_channel_progress/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
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

export async function loadAuditorRanking(from: Date, to: Date, view: QaRankingView = 'team'): Promise<AuditorRankingRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_auditor_ranking', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load the auditor ranking: ${error.message}`)
  return (data ?? []).map(fromRow)
}

export async function loadCoachingTarget(): Promise<number | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('qa_coaching_targets').select('weekly_target').is('effective_to', null).maybeSingle()
  if (error) throw new Error(`Could not load the coaching target: ${error.message}`)
  return data?.weekly_target ?? null
}

export interface ChannelProgressRow {
  channel: string
  agentsCount: number
  auditsDone: number
  auditTarget: number
  auditsPct: number | null
}

export async function loadChannelProgress(from: Date, to: Date, view: QaRankingView = 'team'): Promise<ChannelProgressRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_channel_progress', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load channel-wise progress: ${error.message}`)
  return (data ?? []).map((r: { channel: string; agents_count: number; audits_done: number; audit_target: number; audits_pct: number | null }) => ({
    channel: r.channel,
    agentsCount: r.agents_count,
    auditsDone: r.audits_done,
    auditTarget: r.audit_target,
    auditsPct: r.audits_pct,
  }))
}
