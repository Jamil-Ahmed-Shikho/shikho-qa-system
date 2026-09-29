'use server'
// ============================================================
// SHIKHO QA SYSTEM — Review Request server actions (§4, Section D, Part 1)
// REPLACES disputes/actions.ts entirely. Return { ok, error }, never throw
// (§14). Every write goes through the schema_048 functions with the session
// client, so the database is the real gate; the role checks here only give
// friendlier messages. NO EMAIL, NO NOTIFICATION. Every change is logged.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { validateNote, validateReason } from './validation'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const QA_ADMIN_ROLES = ['super_admin', 'qa_manager']

/** The database's own messages come from RAISE EXCEPTION and are already plain language. */
function plain(message: string): string {
  return /row-level security/i.test(message) ? 'You are not allowed to do that.' : message
}

async function log(actorId: string, action: string, recordId: string | null, after: Record<string, unknown>) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'review_requests', record_id: recordId, after_data: after }])
}

function refresh(auditId: string, reauditId?: string | null) {
  revalidatePath(`/audits/${auditId}`)
  revalidatePath(`/my-audits/${auditId}`)
  revalidatePath('/my-audits')
  revalidatePath('/admin/review-requests')
  revalidatePath('/dashboard/admin')
  revalidatePath('/dashboard/auditor')
  if (reauditId) revalidatePath(`/audits/${reauditId}`)
}

/** The agent — or their Team Lead/Manager on their behalf (the database records which). */
export async function fileReviewRequestAction(auditId: string, reason: string): Promise<ActionResult<{ id: string }>> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!['agent', 'team_lead', 'manager'].includes(user.role)) {
    return { ok: false, error: 'Only the agent — or their Team Lead or Manager on their behalf — can file a Review Request.' }
  }
  const bad = validateReason(reason)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('file_review_request', { p_audit_id: auditId, p_reason: reason })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, `review_request.filed_by_${user.role}`, data as string, { auditId })
  refresh(auditId)
  return { ok: true, id: data as string }
}

/** The Team Lead's own decision — uphold (final) or escalate. */
export async function teamLeadDecideAction(id: string, auditId: string, decision: 'uphold' | 'escalate', note: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (user.role !== 'team_lead') return { ok: false, error: 'Only a Team Lead can make this decision.' }
  const bad = validateNote(note)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('team_lead_decide_review_request', { p_id: id, p_decision: decision, p_note: note })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, `review_request.team_lead_${decision}`, id, { auditId })
  refresh(auditId)
  return { ok: true }
}

export async function assignReviewRequestAction(id: string, auditId: string, assignee: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!QA_ADMIN_ROLES.includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can assign a Review Request.' }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('qa_manager_assign_review_request', { p_id: id, p_assignee: assignee })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, 'review_request.assigned', id, { auditId, assignee })
  refresh(auditId)
  return { ok: true }
}

/** Starts the re-audit — a real new `audits` row, scored through the normal scorecard. The caller
 * (a client component) navigates to /audits/{reauditId} itself once this returns ok, the same "go
 * score it" flow as opening any other audit — never redirected from inside a server action. */
export async function startReauditAction(id: string, auditId: string): Promise<ActionResult<{ reauditId: string }>> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!['super_admin', 'qa_manager', 'qa_auditor'].includes(user.role)) return { ok: false, error: 'Only QA staff can start a re-audit.' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('start_review_reaudit', { p_id: id })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, 'review_request.reaudit_started', id, { auditId, reauditId: data })
  refresh(auditId, data as string)
  return { ok: true, reauditId: data as string }
}

export async function decideRevisionAction(id: string, auditId: string, decision: 'approve' | 'reject', note: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!QA_ADMIN_ROLES.includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can decide a Review Request.' }
  const bad = validateNote(note)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('qa_manager_decide_review_revision', { p_id: id, p_decision: decision, p_note: note })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, `review_request.revision_${decision}d`, id, { auditId })
  refresh(auditId)
  return { ok: true }
}
