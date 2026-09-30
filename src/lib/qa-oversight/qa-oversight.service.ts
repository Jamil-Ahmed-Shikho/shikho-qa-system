// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 5: Review Request oversight
// and calibration consistency (§11). Server-only. Every function does its
// own role check — super_admin/qa_manager (Team View, always) or qa_auditor
// (My View or Team View) — see schema_056.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingQaOversightSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_review_request_status_summary|qa_review_request_team_lead_outcomes|qa_review_request_auditor_outcomes|qa_calibration_session_overview|qa_calibration_consistency/i.test(m)
    && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface ReviewRequestOpenRow {
  requestId: string
  auditId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  filerRole: 'agent' | 'team_lead' | 'manager'
  status: 'with_team_lead' | 'with_qa_manager'
  heldByName: string | null
  daysOpen: number
  createdAt: string
}

export async function loadReviewRequestStatusSummary(view: QaRankingView = 'team'): Promise<ReviewRequestOpenRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_review_request_status_summary', { p_view: view })
  if (error) throw new Error(`Could not load open Review Requests: ${error.message}`)
  return (data ?? []).map((r: {
    request_id: string; audit_id: string; agent_id: string; agent_name: string; team_name: string | null; site_name: string | null
    filer_role: 'agent' | 'team_lead' | 'manager'; status: 'with_team_lead' | 'with_qa_manager'; held_by_name: string | null
    days_open: number; created_at: string
  }) => ({
    requestId: r.request_id, auditId: r.audit_id, agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    filerRole: r.filer_role, status: r.status, heldByName: r.held_by_name, daysOpen: r.days_open, createdAt: r.created_at,
  }))
}

export interface TeamLeadOutcomeRow {
  teamLeadId: string
  teamLeadName: string
  decidedCount: number
  upheldCount: number
  escalatedCount: number
  upheldPct: number
}

export async function loadReviewRequestTeamLeadOutcomes(from: Date, to: Date, view: QaRankingView = 'team'): Promise<TeamLeadOutcomeRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_review_request_team_lead_outcomes', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load Team Lead outcomes: ${error.message}`)
  return (data ?? []).map((r: { team_lead_id: string; team_lead_name: string; decided_count: number; upheld_count: number; escalated_count: number; upheld_pct: number }) => ({
    teamLeadId: r.team_lead_id, teamLeadName: r.team_lead_name, decidedCount: r.decided_count, upheldCount: r.upheld_count,
    escalatedCount: r.escalated_count, upheldPct: r.upheld_pct,
  }))
}

export interface AuditorOutcomeRow {
  auditorId: string
  auditorName: string
  filedCount: number
  resolvedCount: number
  revisedCount: number
  noChangeCount: number
  revisionPct: number | null
}

export async function loadReviewRequestAuditorOutcomes(from: Date, to: Date, view: QaRankingView = 'team'): Promise<AuditorOutcomeRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_review_request_auditor_outcomes', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load auditor outcomes: ${error.message}`)
  return (data ?? []).map((r: { auditor_id: string; auditor_name: string; filed_count: number; resolved_count: number; revised_count: number; no_change_count: number; revision_pct: number | null }) => ({
    auditorId: r.auditor_id, auditorName: r.auditor_name, filedCount: r.filed_count, resolvedCount: r.resolved_count,
    revisedCount: r.revised_count, noChangeCount: r.no_change_count, revisionPct: r.revision_pct,
  }))
}

export interface CalibrationSessionRow {
  sessionId: string
  title: string
  teamName: string
  siteName: string
  scheduledAt: string
  status: 'scheduled' | 'closed' | 'cancelled'
  participantsCount: number
  scoresSubmittedCount: number
  groupMeanScore: number | null
  groupStddev: number | null
  scoreRange: number | null
}

export async function loadCalibrationSessionOverview(from: Date, to: Date, view: QaRankingView = 'team'): Promise<CalibrationSessionRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_calibration_session_overview', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load calibration sessions: ${error.message}`)
  return (data ?? []).map((r: {
    session_id: string; title: string; team_name: string; site_name: string; scheduled_at: string; status: 'scheduled' | 'closed' | 'cancelled'
    participants_count: number; scores_submitted_count: number; group_mean_score: number | null; group_stddev: number | null; score_range: number | null
  }) => ({
    sessionId: r.session_id, title: r.title, teamName: r.team_name, siteName: r.site_name, scheduledAt: r.scheduled_at, status: r.status,
    participantsCount: r.participants_count, scoresSubmittedCount: r.scores_submitted_count, groupMeanScore: r.group_mean_score,
    groupStddev: r.group_stddev, scoreRange: r.score_range,
  }))
}

export interface CalibrationConsistencyRow {
  userId: string
  userName: string
  userRole: string
  sessionsScored: number
  avgAbsDeviation: number
  avgSignedDeviation: number
}

export async function loadCalibrationConsistency(from: Date, to: Date, view: QaRankingView = 'team'): Promise<CalibrationConsistencyRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_calibration_consistency', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load calibration consistency: ${error.message}`)
  return (data ?? []).map((r: { user_id: string; user_name: string; user_role: string; sessions_scored: number; avg_abs_deviation: number; avg_signed_deviation: number }) => ({
    userId: r.user_id, userName: r.user_name, userRole: r.user_role, sessionsScored: r.sessions_scored,
    avgAbsDeviation: r.avg_abs_deviation, avgSignedDeviation: r.avg_signed_deviation,
  }))
}
