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
import { createNotifications } from '@/lib/notifications/notifications.service'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { loadQaManagers } from '@/lib/audits/audit-notifications'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const QA_ADMIN_ROLES = ['super_admin', 'qa_manager']

/** The database's own messages come from RAISE EXCEPTION and are already plain language. */
function plain(message: string): string {
  return /row-level security/i.test(message) ? 'You are not allowed to do that.' : message
}

async function log(actorId: string, action: string, recordId: string | null, after: Record<string, unknown>) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'review_requests', record_id: recordId, after_data: after }])
}

/** The agent's name on an audit — used only to word a notification; looked up with the service
 * role since the caller (a Team Lead escalating, or QA deciding who to assign) may not have RLS
 * visibility into the agent's own row. */
async function auditAgentName(auditId: string): Promise<string> {
  const admin = getSupabaseAdmin()
  const { data } = await admin.from('audits').select('agent:users!audits_agent_id_fkey(name)').eq('id', auditId).maybeSingle()
  type OneOrMany<T> = T | T[] | null
  const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  return one(data?.agent as OneOrMany<{ name: string }>)?.name ?? 'An agent'
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
  const id = data as string
  await log(user.profile.id, `review_request.filed_by_${user.role}`, id, { auditId })

  // In-app notification (schema_064) to whoever it now lands with: the agent's own Team Lead when
  // the agent filed it themselves, or every QA Manager when a Team Lead/Manager filed it on the
  // agent's behalf (schema_048: that case skips straight to with_qa_manager, unassigned).
  if (user.role === 'agent' && user.profile.team_leader_id) {
    await createNotifications([{
      recipientId: user.profile.team_leader_id,
      type: 'review_request_landed',
      title: 'A review request needs your decision',
      body: `${user.profile.name} requested a review of their audit — uphold it, or escalate to QA.`,
      link: `/audits/${auditId}`,
      relatedTable: 'review_requests',
      relatedId: id,
    }])
  } else if (user.role !== 'agent') {
    const agentName = await auditAgentName(auditId)
    const qaManagers = await loadQaManagers()
    await createNotifications(qaManagers.map((m) => ({
      recipientId: m.id,
      type: 'review_request_landed' as const,
      title: 'A review request is waiting for assignment',
      body: `${user.profile.name} filed a review request on behalf of ${agentName} — assign it to yourself or an auditor.`,
      link: `/admin/review-requests`,
      relatedTable: 'review_requests',
      relatedId: id,
    })))
  }

  refresh(auditId)
  return { ok: true, id }
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

  if (decision === 'escalate') {
    const agentName = await auditAgentName(auditId)
    const qaManagers = await loadQaManagers()
    await createNotifications(qaManagers.map((m) => ({
      recipientId: m.id,
      type: 'review_request_landed' as const,
      title: 'A review request is waiting for assignment',
      body: `${user.profile.name} escalated ${agentName}'s review request — assign it to yourself or an auditor.`,
      link: `/admin/review-requests`,
      relatedTable: 'review_requests',
      relatedId: id,
    })))
  }

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

  if (assignee !== user.profile.id) {
    const agentName = await auditAgentName(auditId)
    await createNotifications([{
      recipientId: assignee,
      type: 'review_request_landed',
      title: 'A review request was assigned to you',
      body: `${user.profile.name} assigned you ${agentName}'s review request — start the re-audit when ready.`,
      link: `/audits/${auditId}`,
      relatedTable: 'review_requests',
      relatedId: id,
    }])
  }

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
