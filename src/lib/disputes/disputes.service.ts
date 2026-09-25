// ============================================================
// SHIKHO QA SYSTEM — Disputes service (§4, Step 5)
// Server-only. Reads run as the signed-in user, so row-level security
// (schema_028) decides what each role sees: the agent their own, a Team Lead
// their team's, a Manager their chain's, a QA Auditor the disputes on audits
// they conducted, QA Manager / Super Admin everything.
//
// NOTHING HERE SENDS EMAIL OR ANY NOTIFICATION.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

import type { DisputeOutcome, DisputeStatus } from './validation'
export { OUTCOME_LABEL, STATUS_LABEL, type DisputeOutcome, type DisputeStatus } from './validation'

export interface DisputeView {
  id: string
  auditId: string
  status: DisputeStatus
  reason: string
  createdAt: string
  /** true when the Team Lead filed it for the agent — must always be shown as such. */
  filedOnBehalf: boolean
  raisedById: string
  /** Null when the viewer's own access can't read that person's name. */
  raisedByName: string | null
  agentId: string
  agentName: string | null
  outcome: DisputeOutcome | null
  resolutionNote: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  resolvedByName: string | null
  resolvedAt: string | null
}

export interface DisputeListItem extends DisputeView {
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
  dispute: { status: DisputeStatus; outcome: DisputeOutcome | null; filedOnBehalf: boolean } | null
}

/** True when a failed read looks like "the disputes table doesn't exist" (schema_028 not applied yet). */
export function isMissingDisputesSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /disputes|file_dispute|resolve_dispute|pending_reaudits/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

const DISPUTE_SELECT =
  'id, audit_id, status, reason, created_at, filed_on_behalf, raised_by, agent_id, outcome, resolution_note, reviewed_at, resolved_at, ' +
  'raiser:users!disputes_raised_by_fkey(name), agent:users!disputes_agent_id_fkey(name), ' +
  'reviewer:users!disputes_reviewed_by_fkey(name), resolver:users!disputes_resolved_by_fkey(name)'

function fromRow(r: Record<string, unknown>): DisputeView {
  const name = (k: string) => (r[k] as { name: string } | null)?.name ?? null
  return {
    id: r.id as string,
    auditId: r.audit_id as string,
    status: r.status as DisputeStatus,
    reason: r.reason as string,
    createdAt: r.created_at as string,
    filedOnBehalf: !!r.filed_on_behalf,
    raisedById: r.raised_by as string,
    raisedByName: name('raiser'),
    agentId: r.agent_id as string,
    agentName: name('agent'),
    outcome: (r.outcome as DisputeOutcome | null) ?? null,
    resolutionNote: (r.resolution_note as string | null) ?? null,
    reviewedByName: name('reviewer'),
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    resolvedByName: name('resolver'),
    resolvedAt: (r.resolved_at as string | null) ?? null,
  }
}

/** The dispute on an audit, or null if there is none. A failed read THROWS — never "no dispute". */
export async function loadDisputeForAudit(auditId: string): Promise<DisputeView | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('disputes').select(DISPUTE_SELECT).eq('audit_id', auditId).maybeSingle()
  if (error) throw new Error(`Could not load the dispute: ${error.message}`)
  return data ? fromRow(data as unknown as Record<string, unknown>) : null
}

/** Admin list. 'awaiting' = open + under review (everything still needing a decision). */
export async function listDisputes(status: DisputeStatus | 'awaiting' | 'all' = 'awaiting'): Promise<DisputeListItem[]> {
  const supabase = await getSupabaseServer()
  let q = supabase
    .from('disputes')
    .select(DISPUTE_SELECT + ', audit:audits(score_percent, passed, critical_fail, submitted_at, auditor_id, auditor:users!audits_auditor_id_fkey(name))')
    .order('created_at', { ascending: false })
    .limit(300)
  if (status === 'awaiting') q = q.in('status', ['open', 'under_review'])
  else if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`Could not load disputes: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const a = r.audit as { score_percent: number | null; passed: boolean | null; critical_fail: boolean; submitted_at: string | null; auditor_id: string | null; auditor: { name: string } | null } | null
    return {
      ...fromRow(r),
      auditScore: a?.score_percent === null || a?.score_percent === undefined ? null : Number(a.score_percent),
      auditPassed: a?.passed ?? null,
      auditCriticalFail: !!a?.critical_fail,
      auditSubmittedAt: a?.submitted_at ?? null,
      auditorId: a?.auditor_id ?? null,
      auditorName: a?.auditor?.name ?? null,
    }
  })
}

/** How many disputes are waiting for a decision (open + under review) — for the admin dashboard card. */
export async function countDisputesAwaitingDecision(): Promise<number> {
  const supabase = await getSupabaseServer()
  const { count, error } = await supabase.from('disputes').select('*', { count: 'exact', head: true }).in('status', ['open', 'under_review'])
  if (error) throw new Error(`Could not count disputes: ${error.message}`)
  return count ?? 0
}

/** The signed-in agent's own submitted audits (RLS limits it to theirs), newest first, with any dispute on each. */
export async function loadMyAudits(): Promise<MyAuditItem[]> {
  const supabase = await getSupabaseServer()
  const [audits, disputes] = await Promise.all([
    supabase
      .from('audits')
      .select('id, status, score_percent, passed, critical_fail, submitted_at, call_started_at')
      .neq('status', 'draft')
      .order('submitted_at', { ascending: false })
      .limit(200),
    supabase.from('disputes').select('audit_id, status, outcome, filed_on_behalf').limit(500),
  ])
  if (audits.error) throw new Error(`Could not load your audits: ${audits.error.message}`)
  if (disputes.error) throw new Error(`Could not load your disputes: ${disputes.error.message}`)
  const byAudit = new Map((disputes.data ?? []).map((d) => [d.audit_id as string, d]))
  return (audits.data ?? []).map((a) => {
    const d = byAudit.get(a.id as string)
    return {
      id: a.id as string,
      status: a.status as string,
      scorePercent: a.score_percent === null ? null : Number(a.score_percent),
      passed: (a.passed as boolean | null) ?? null,
      criticalFail: !!a.critical_fail,
      submittedAt: (a.submitted_at as string | null) ?? null,
      callStartedAt: (a.call_started_at as string | null) ?? null,
      dispute: d ? { status: d.status as DisputeStatus, outcome: (d.outcome as DisputeOutcome | null) ?? null, filedOnBehalf: !!d.filed_on_behalf } : null,
    }
  })
}
