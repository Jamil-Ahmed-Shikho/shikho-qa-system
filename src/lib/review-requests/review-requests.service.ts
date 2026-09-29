// ============================================================
// SHIKHO QA SYSTEM — Review Requests service (§4, Section D, Part 1)
// REPLACES disputes.service.ts entirely (schema_048 dropped the disputes table).
// Server-only. Reads run as the signed-in user, so row-level security decides
// what each role sees: the agent their own, a Team Lead their team's, a
// Manager their chain's, a QA Auditor a request assigned to them or on an
// audit they conducted, QA Manager / Super Admin everything.
//
// NOTHING HERE SENDS EMAIL OR ANY NOTIFICATION.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { FilerRole, FinalOutcome, ReviewRequestStatus, TeamLeadDecision } from './validation'
export { STATUS_LABEL, FINAL_OUTCOME_LABEL, filedByLine, type ReviewRequestStatus, type FinalOutcome, type TeamLeadDecision, type FilerRole } from './validation'

export interface ReviewRequestView {
  id: string
  auditId: string
  status: ReviewRequestStatus
  reason: string
  createdAt: string
  filerRole: FilerRole
  raisedById: string
  raisedByName: string | null
  agentId: string
  agentName: string | null
  teamLeadDecision: TeamLeadDecision | null
  teamLeadDecidedByName: string | null
  teamLeadDecidedAt: string | null
  teamLeadNote: string | null
  assignedToId: string | null
  assignedToName: string | null
  reaudit: { id: string; status: string; scorePercent: number | null; passed: boolean | null } | null
  finalOutcome: FinalOutcome | null
  finalDecidedByName: string | null
  finalDecidedAt: string | null
  finalNote: string | null
}

export interface ReviewRequestListItem extends ReviewRequestView {
  auditScore: number | null
  auditPassed: boolean | null
  auditCriticalFail: boolean
  auditSubmittedAt: string | null
  auditorId: string | null
  auditorName: string | null
}

export interface MyAuditItem {
  id: string
  status: string
  scorePercent: number | null
  passed: boolean | null
  criticalFail: boolean
  submittedAt: string | null
  callStartedAt: string | null
  supersededBy: string | null
  reviewRequest: { status: ReviewRequestStatus; finalOutcome: FinalOutcome | null; filerRole: FilerRole } | null
}

/** True when a failed read looks like "review_requests doesn't exist yet" (schema_048 not applied). */
export function isMissingReviewRequestSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /review_requests|file_review_request|review_reaudit|review_revision/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

const SELECT =
  'id, audit_id, status, reason, created_at, filer_role, raised_by, agent_id, ' +
  'team_lead_decision, team_lead_decided_at, team_lead_note, assigned_to, reaudit_audit_id, ' +
  'final_outcome, final_decided_at, final_note, ' +
  'raiser:users!review_requests_raised_by_fkey(name), agent:users!review_requests_agent_id_fkey(name), ' +
  'tl_decider:users!review_requests_team_lead_decided_by_fkey(name), assignee:users!review_requests_assigned_to_fkey(name), ' +
  'final_decider:users!review_requests_final_decided_by_fkey(name), ' +
  'reaudit:audits!review_requests_reaudit_audit_id_fkey(id, status, score_percent, passed)'

function fromRow(r: Record<string, unknown>): ReviewRequestView {
  const name = (k: string) => {
    const v = r[k] as { name: string } | { name: string }[] | null
    return (Array.isArray(v) ? v[0]?.name : v?.name) ?? null
  }
  const ra = r.reaudit as { id: string; status: string; score_percent: number | null; passed: boolean | null } | { id: string; status: string; score_percent: number | null; passed: boolean | null }[] | null
  const reaudit = Array.isArray(ra) ? ra[0] : ra
  return {
    id: r.id as string,
    auditId: r.audit_id as string,
    status: r.status as ReviewRequestStatus,
    reason: r.reason as string,
    createdAt: r.created_at as string,
    filerRole: r.filer_role as FilerRole,
    raisedById: r.raised_by as string,
    raisedByName: name('raiser'),
    agentId: r.agent_id as string,
    agentName: name('agent'),
    teamLeadDecision: (r.team_lead_decision as TeamLeadDecision | null) ?? null,
    teamLeadDecidedByName: name('tl_decider'),
    teamLeadDecidedAt: (r.team_lead_decided_at as string | null) ?? null,
    teamLeadNote: (r.team_lead_note as string | null) ?? null,
    assignedToId: (r.assigned_to as string | null) ?? null,
    assignedToName: name('assignee'),
    reaudit: reaudit ? { id: reaudit.id, status: reaudit.status, scorePercent: reaudit.score_percent === null ? null : Number(reaudit.score_percent), passed: reaudit.passed } : null,
    finalOutcome: (r.final_outcome as FinalOutcome | null) ?? null,
    finalDecidedByName: name('final_decider'),
    finalDecidedAt: (r.final_decided_at as string | null) ?? null,
    finalNote: (r.final_note as string | null) ?? null,
  }
}

/** The Review Request on an audit, or null if there is none. A failed read THROWS — never "no request". */
export async function loadReviewRequestForAudit(auditId: string): Promise<ReviewRequestView | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('review_requests').select(SELECT).eq('audit_id', auditId).maybeSingle()
  if (error) throw new Error(`Could not load the Review Request: ${error.message}`)
  return data ? fromRow(data as unknown as Record<string, unknown>) : null
}

export type AdminView = 'with_qa_manager' | 'with_team_lead' | 'resolved' | 'all'

/** Admin list (QA Manager / Super Admin — RLS gives them everything). */
export async function listReviewRequests(view: AdminView = 'with_qa_manager'): Promise<ReviewRequestListItem[]> {
  const supabase = await getSupabaseServer()
  let q = supabase
    .from('review_requests')
    .select(SELECT + ', audit:audits!review_requests_audit_id_fkey(score_percent, passed, critical_fail, submitted_at, auditor_id, auditor:users!audits_auditor_id_fkey(name))')
    .order('created_at', { ascending: false })
    .limit(300)
  if (view !== 'all') q = q.eq('status', view)
  const { data, error } = await q
  if (error) throw new Error(`Could not load Review Requests: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const av = r.audit as { score_percent: number | null; passed: boolean | null; critical_fail: boolean; submitted_at: string | null; auditor_id: string | null; auditor: { name: string } | { name: string }[] | null } | { score_percent: number | null; passed: boolean | null; critical_fail: boolean; submitted_at: string | null; auditor_id: string | null; auditor: { name: string } | { name: string }[] | null }[] | null
    const a = Array.isArray(av) ? av[0] : av
    const auditorName = a?.auditor ? (Array.isArray(a.auditor) ? a.auditor[0]?.name : a.auditor.name) : null
    return {
      ...fromRow(r),
      auditScore: a?.score_percent === null || a?.score_percent === undefined ? null : Number(a.score_percent),
      auditPassed: a?.passed ?? null,
      auditCriticalFail: !!a?.critical_fail,
      auditSubmittedAt: a?.submitted_at ?? null,
      auditorId: a?.auditor_id ?? null,
      auditorName: auditorName ?? null,
    }
  })
}

/** How many need a QA Manager's attention (waiting on them to assign or decide) — for the admin dashboard card. */
export async function countReviewRequestsAwaitingDecision(): Promise<number> {
  const supabase = await getSupabaseServer()
  const { count, error } = await supabase.from('review_requests').select('*', { count: 'exact', head: true }).eq('status', 'with_qa_manager')
  if (error) throw new Error(`Could not count Review Requests: ${error.message}`)
  return count ?? 0
}

/** Requests assigned to the signed-in QA Auditor, not yet re-audited — for their own dashboard. */
export async function loadAssignedToMe(userId: string): Promise<ReviewRequestListItem[]> {
  const list = await listReviewRequests('with_qa_manager')
  return list.filter((r) => r.assignedToId === userId && !r.reaudit)
}

/** The signed-in agent's own submitted audits (RLS limits it to theirs), newest first, with any Review Request. */
export async function loadMyAudits(): Promise<MyAuditItem[]> {
  const supabase = await getSupabaseServer()
  const [audits, requests] = await Promise.all([
    supabase
      .from('audits')
      .select('id, status, score_percent, passed, critical_fail, submitted_at, call_started_at, superseded_by')
      .neq('status', 'draft')
      .is('review_request_id', null) // a re-audit is not one of "my audits" in its own right
      .order('submitted_at', { ascending: false })
      .limit(200),
    supabase.from('review_requests').select('audit_id, status, final_outcome, filer_role').limit(500),
  ])
  if (audits.error) throw new Error(`Could not load your audits: ${audits.error.message}`)
  if (requests.error) throw new Error(`Could not load your Review Requests: ${requests.error.message}`)
  const byAudit = new Map((requests.data ?? []).map((r) => [r.audit_id as string, r]))
  return (audits.data ?? []).map((a) => {
    const r = byAudit.get(a.id as string)
    return {
      id: a.id as string,
      status: a.status as string,
      scorePercent: a.score_percent === null ? null : Number(a.score_percent),
      passed: (a.passed as boolean | null) ?? null,
      criticalFail: !!a.critical_fail,
      submittedAt: (a.submitted_at as string | null) ?? null,
      callStartedAt: (a.call_started_at as string | null) ?? null,
      supersededBy: (a.superseded_by as string | null) ?? null,
      reviewRequest: r ? { status: r.status as ReviewRequestStatus, finalOutcome: (r.final_outcome as FinalOutcome | null) ?? null, filerRole: r.filer_role as FilerRole } : null,
    }
  })
}

export interface EffectiveResult {
  scorePercent: number | null
  passed: boolean | null
  criticalFail: boolean
  passMarkUsed: number | null
  submittedAt: string | null
  overallFeedback: string | null
  rubricId: string
  /** Set when this IS the revised figures (i.e. the caller asked about an audit that has been superseded). */
  isRevision: boolean
}

/**
 * The figures to actually SHOW for an audit — if it has been superseded by an approved
 * revision (Q16), that revision's own score/feedback/rubric, not the stale original. The
 * ORIGINAL row is never edited (§4) — this just decides which row's numbers are authoritative
 * to display. Both `/audits/[id]` and `/my-audits/[id]` call this rather than each re-deriving it.
 */
export async function loadEffectiveResult(audit: {
  score_percent: number | null; passed: boolean | null; critical_fail: boolean; pass_mark_used: number | null
  submitted_at: string | null; overall_feedback: string | null; rubric_id: string; superseded_by: string | null
}): Promise<EffectiveResult> {
  if (!audit.superseded_by) {
    return {
      scorePercent: audit.score_percent === null ? null : Number(audit.score_percent),
      passed: audit.passed, criticalFail: audit.critical_fail,
      passMarkUsed: audit.pass_mark_used === null ? null : Number(audit.pass_mark_used),
      submittedAt: audit.submitted_at, overallFeedback: audit.overall_feedback, rubricId: audit.rubric_id, isRevision: false,
    }
  }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('audits')
    .select('score_percent, passed, critical_fail, pass_mark_used, submitted_at, overall_feedback, rubric_id')
    .eq('id', audit.superseded_by)
    .maybeSingle()
  if (error || !data) {
    // Fall back to the original rather than break the page — the banner still names the revision.
    return {
      scorePercent: audit.score_percent === null ? null : Number(audit.score_percent),
      passed: audit.passed, criticalFail: audit.critical_fail,
      passMarkUsed: audit.pass_mark_used === null ? null : Number(audit.pass_mark_used),
      submittedAt: audit.submitted_at, overallFeedback: audit.overall_feedback, rubricId: audit.rubric_id, isRevision: false,
    }
  }
  return {
    scorePercent: data.score_percent === null ? null : Number(data.score_percent),
    passed: data.passed, criticalFail: data.critical_fail,
    passMarkUsed: data.pass_mark_used === null ? null : Number(data.pass_mark_used),
    submittedAt: data.submitted_at, overallFeedback: data.overall_feedback, rubricId: data.rubric_id, isRevision: true,
  }
}
