// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 3: RYG breakdown, PIP
// overview (historic + live), Zero-Seller overview, fatal-incident overview
// (§11). Server-only. Every function does its own role check (§11 Stage 3:
// super_admin/qa_manager (Team View, always) or qa_auditor (My View or Team
// View) — see schema_054.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingQaOverviewSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_ryg_breakdown|qa_zero_seller_overview|qa_fatal_incident_overview|qa_pip_history_summary|qa_pip_live_progress/i.test(m)
    && /(does not exist|schema cache|could not find)/i.test(m)
}

export type RygStatus = 'red' | 'yellow' | 'green' | 'unrated'

export interface RygBreakdownRow {
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  status: RygStatus
  avgAuditScore: number | null
  criticalFatalCount: number
  periodEnd: string | null
}

export async function loadRygBreakdown(view: QaRankingView = 'team'): Promise<RygBreakdownRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_ryg_breakdown', { p_view: view })
  if (error) throw new Error(`Could not load the RYG breakdown: ${error.message}`)
  return (data ?? []).map((r: { agent_id: string; agent_name: string; team_name: string | null; site_name: string | null; status: RygStatus; avg_audit_score: number | null; critical_fatal_count: number; period_end: string | null }) => ({
    agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    status: r.status, avgAuditScore: r.avg_audit_score, criticalFatalCount: r.critical_fatal_count, periodEnd: r.period_end,
  }))
}

export interface ZeroSellerRow {
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  currentStreakWeeks: number
  streakStartWeek: string | null
  lastSaleDate: string | null
}

export async function loadZeroSellerOverview(view: QaRankingView = 'team'): Promise<ZeroSellerRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_zero_seller_overview', { p_view: view })
  if (error) throw new Error(`Could not load the Zero-Seller overview: ${error.message}`)
  return (data ?? []).map((r: { agent_id: string; agent_name: string; team_name: string | null; site_name: string | null; current_streak_weeks: number; streak_start_week: string | null; last_sale_date: string | null }) => ({
    agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    currentStreakWeeks: r.current_streak_weeks, streakStartWeek: r.streak_start_week, lastSaleDate: r.last_sale_date,
  }))
}

export interface FatalIncidentRow {
  auditId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  auditorName: string | null
  submittedAt: string
}

export async function loadFatalIncidentOverview(from: Date, to: Date, view: QaRankingView = 'team'): Promise<FatalIncidentRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_fatal_incident_overview', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load the fatal-incident overview: ${error.message}`)
  return (data ?? []).map((r: { audit_id: string; agent_id: string; agent_name: string; team_name: string | null; site_name: string | null; auditor_name: string | null; submitted_at: string }) => ({
    auditId: r.audit_id, agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    auditorName: r.auditor_name, submittedAt: r.submitted_at,
  }))
}

export interface PipHistoryRow {
  cycleId: string
  month: string
  suggestedCount: number
  excludedCount: number
  approvedCount: number
  completedCount: number
  failedCount: number
}

export async function loadPipHistorySummary(view: QaRankingView = 'team'): Promise<PipHistoryRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_pip_history_summary', { p_view: view })
  if (error) throw new Error(`Could not load the PIP history summary: ${error.message}`)
  return (data ?? []).map((r: { cycle_id: string; month: string; suggested_count: number; excluded_count: number; approved_count: number; completed_count: number; failed_count: number }) => ({
    cycleId: r.cycle_id, month: r.month, suggestedCount: r.suggested_count, excludedCount: r.excluded_count,
    approvedCount: r.approved_count, completedCount: r.completed_count, failedCount: r.failed_count,
  }))
}

export interface PipLiveProgressRow {
  agentId: string
  agentName: string
  teamLeaderName: string | null
  siteName: string | null
  auditorName: string | null
  cycleMonth: string
  cycleEndDate: string
  targetUsd: number | null
  achievedUsd: number
  daysLeft: number
  runRateRequiredUsdPerDay: number | null
  targetMet: boolean | null
}

export async function loadPipLiveProgress(view: QaRankingView = 'team'): Promise<PipLiveProgressRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_pip_live_progress', { p_view: view })
  if (error) throw new Error(`Could not load the current PIP cycle's live progress: ${error.message}`)
  return (data ?? []).map((r: {
    agent_id: string; agent_name: string; team_leader_name: string | null; site_name: string | null; auditor_name: string | null
    cycle_month: string; cycle_end_date: string; target_usd: number | null; achieved_usd: number; days_left: number
    run_rate_required_usd_per_day: number | null; target_met: boolean | null
  }) => ({
    agentId: r.agent_id, agentName: r.agent_name, teamLeaderName: r.team_leader_name, siteName: r.site_name, auditorName: r.auditor_name,
    cycleMonth: r.cycle_month, cycleEndDate: r.cycle_end_date, targetUsd: r.target_usd, achievedUsd: r.achieved_usd,
    daysLeft: r.days_left, runRateRequiredUsdPerDay: r.run_rate_required_usd_per_day, targetMet: r.target_met,
  }))
}
