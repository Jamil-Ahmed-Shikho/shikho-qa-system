'use server'
// ============================================================
// SHIKHO QA SYSTEM — Dispute server actions (§4, Step 5)
// Return { ok, error }, never throw (§14). Every write goes through the
// schema_028 functions with the session client, so the database is the real
// gate; the role checks here only give friendlier messages.
// NO EMAIL, NO NOTIFICATION. Every change is recorded in audit_log.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { validateDisputeReason, validateResolution } from './validation'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const ADMIN_ROLES = ['super_admin', 'qa_manager']

/** The database's own messages come from RAISE EXCEPTION and are already plain language. */
function plain(message: string): string {
  return /row-level security/i.test(message) ? 'You are not allowed to do that.' : message
}

async function log(actorId: string, action: string, recordId: string | null, after: Record<string, unknown>) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'disputes', record_id: recordId, after_data: after }])
}

function refresh(auditId: string) {
  revalidatePath(`/audits/${auditId}`)
  revalidatePath(`/my-audits/${auditId}`)
  revalidatePath('/my-audits')
  revalidatePath('/admin/disputes')
}

/** The agent — or their Team Lead on their behalf (the database records which). */
export async function fileDisputeAction(auditId: string, reason: string): Promise<ActionResult<{ id: string }>> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (user.role !== 'agent' && user.role !== 'team_lead') return { ok: false, error: 'Only the agent — or their Team Lead on their behalf — can file a dispute.' }
  const bad = validateDisputeReason(reason)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('file_dispute', { p_audit_id: auditId, p_reason: reason })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, user.role === 'team_lead' ? 'dispute.filed_by_team_lead' : 'dispute.filed', data as string, { auditId, onBehalf: user.role === 'team_lead' })
  refresh(auditId)
  return { ok: true, id: data as string }
}

export async function startReviewAction(disputeId: string, auditId: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!ADMIN_ROLES.includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can review a dispute.' }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('start_dispute_review', { p_dispute_id: disputeId })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, 'dispute.review_started', disputeId, { auditId })
  refresh(auditId)
  return { ok: true }
}

export async function resolveDisputeAction(disputeId: string, auditId: string, outcome: string | null, note: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  if (!ADMIN_ROLES.includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can resolve a dispute.' }
  const bad = validateResolution(outcome, note)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('resolve_dispute', { p_dispute_id: disputeId, p_outcome: outcome, p_note: note })
  if (error) return { ok: false, error: plain(error.message) }
  await log(user.profile.id, 'dispute.resolved', disputeId, { auditId, outcome })
  refresh(auditId)
  return { ok: true }
}
