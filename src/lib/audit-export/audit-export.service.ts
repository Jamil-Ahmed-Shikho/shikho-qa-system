// ============================================================
// SHIKHO QA SYSTEM — Raw Audit Data Export: data loaders (2026-11-01)
// Server-only. Both RPCs do their own role/scope check (schema_107) —
// super_admin/qa_manager unrestricted, qa_auditor My View/Team View,
// manager own chain, team_lead own team.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingAuditExportSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /raw_audit_export_/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface AuditExportSummaryRow {
  auditId: string
  auditType: string
  rubricName: string | null
  agentName: string
  agentEmpId: string | null
  teamName: string | null
  siteName: string | null
  vintageLabel: string
  auditorName: string | null
  callStartedAt: string | null
  callDurationMinutes: number | null
  crmLeadId: string | null
  callStatus: string | null
  scorePercent: number | null
  passed: boolean | null
  criticalFail: boolean
  fatalCount: number
  fatalSummary: string | null
  overallFeedback: string | null
  submittedAt: string
}

export interface AuditExportFailedParameterRow {
  auditId: string
  agentName: string
  parameterName: string
  pointsLost: number
  feedback: string | null
}

type SummaryRpcRow = {
  audit_id: string; audit_type: string; rubric_name: string | null
  agent_name: string; agent_emp_id: string | null; team_name: string | null; site_name: string | null; vintage_label: string
  auditor_name: string | null; call_started_at: string | null; call_duration_minutes: number | string | null
  crm_lead_id: string | null; call_status: string | null
  score_percent: number | string | null; passed: boolean | null; critical_fail: boolean
  fatal_count: number; fatal_summary: string | null; overall_feedback: string | null; submitted_at: string
}

type FailedParamRpcRow = { audit_id: string; agent_name: string; parameter_name: string; points_lost: number | string; feedback: string | null }

export async function loadAuditExportSummary(
  from: Date, to: Date, view: QaRankingView = 'mine', managerId: string | null = null
): Promise<AuditExportSummaryRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('raw_audit_export_summary', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_manager_id: managerId, p_view: view,
  })
  if (error) throw new Error(`Could not load the audit export: ${error.message}`)
  return (data ?? []).map((r: SummaryRpcRow) => ({
    auditId: r.audit_id, auditType: r.audit_type, rubricName: r.rubric_name,
    agentName: r.agent_name, agentEmpId: r.agent_emp_id, teamName: r.team_name, siteName: r.site_name, vintageLabel: r.vintage_label,
    auditorName: r.auditor_name, callStartedAt: r.call_started_at,
    callDurationMinutes: r.call_duration_minutes === null ? null : Number(r.call_duration_minutes),
    crmLeadId: r.crm_lead_id, callStatus: r.call_status,
    scorePercent: r.score_percent === null ? null : Number(r.score_percent), passed: r.passed, criticalFail: r.critical_fail,
    fatalCount: r.fatal_count, fatalSummary: r.fatal_summary, overallFeedback: r.overall_feedback, submittedAt: r.submitted_at,
  }))
}

export async function loadAuditExportFailedParameters(
  from: Date, to: Date, view: QaRankingView = 'mine', managerId: string | null = null
): Promise<AuditExportFailedParameterRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('raw_audit_export_failed_parameters', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_manager_id: managerId, p_view: view,
  })
  if (error) throw new Error(`Could not load the failed-parameter detail: ${error.message}`)
  return (data ?? []).map((r: FailedParamRpcRow) => ({
    auditId: r.audit_id, agentName: r.agent_name, parameterName: r.parameter_name,
    pointsLost: Number(r.points_lost), feedback: r.feedback,
  }))
}
