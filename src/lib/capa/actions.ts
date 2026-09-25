'use server'
// ============================================================
// SHIKHO QA SYSTEM — CAPA server actions (§4, Step 5)
// Return { ok, error }, never throw (§14). The database decides (schema_028's
// flag_reaudit / unflag_reaudit functions and the link trigger); the checks here
// only give friendlier messages. NO EMAIL, NO NOTIFICATION. Every change is logged.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'

export type ActionResult = { ok: true } | { ok: false; error: string }

const QA_ROLES = ['super_admin', 'qa_manager', 'qa_auditor']

function plain(message: string): string {
  return /row-level security/i.test(message) ? 'You are not allowed to do that.' : message
}

async function log(actorId: string, action: string, auditId: string, after: Record<string, unknown> = {}) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'audits', record_id: auditId, after_data: after }])
}

async function qaUser() {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' } as const
  if (!QA_ROLES.includes(user.role)) return { ok: false, error: 'Only QA staff can change a re-audit flag.' } as const
  return { ok: true, user } as const
}

export async function flagReauditAction(auditId: string): Promise<ActionResult> {
  const a = await qaUser()
  if (!a.ok) return { ok: false, error: a.error }
  const { error } = await (await getSupabaseServer()).rpc('flag_reaudit', { p_audit_id: auditId })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'audit.flagged_for_reaudit', auditId)
  revalidatePath(`/audits/${auditId}`)
  return { ok: true }
}

export async function unflagReauditAction(auditId: string): Promise<ActionResult> {
  const a = await qaUser()
  if (!a.ok) return { ok: false, error: a.error }
  const { error } = await (await getSupabaseServer()).rpc('unflag_reaudit', { p_audit_id: auditId })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'audit.reaudit_flag_removed', auditId)
  revalidatePath(`/audits/${auditId}`)
  return { ok: true }
}

/** Link a DRAFT audit (yours) back to the failed audit it follows up. The database checks it is the same agent and still waiting. */
export async function linkReauditAction(draftAuditId: string, originalAuditId: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('audits').update({ re_audit_of: originalAuditId }).eq('id', draftAuditId).eq('status', 'draft').select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Another audit is already linked as the follow-up to that audit.' }
    return { ok: false, error: plain(error.message) }
  }
  if (!data || data.length === 0) return { ok: false, error: 'Only your own draft audit can be linked.' }
  await log(user.profile.id, 'audit.reaudit_linked', draftAuditId, { originalAuditId })
  revalidatePath(`/audits/${draftAuditId}`)
  revalidatePath(`/audits/${originalAuditId}`)
  return { ok: true }
}

export async function unlinkReauditAction(draftAuditId: string): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }
  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('audits').select('re_audit_of').eq('id', draftAuditId).maybeSingle()
  const { data, error } = await supabase.from('audits').update({ re_audit_of: null }).eq('id', draftAuditId).eq('status', 'draft').select('id')
  if (error) return { ok: false, error: plain(error.message) }
  if (!data || data.length === 0) return { ok: false, error: 'Only your own draft audit can be unlinked.' }
  await log(user.profile.id, 'audit.reaudit_unlinked', draftAuditId, { originalAuditId: before?.re_audit_of ?? null })
  revalidatePath(`/audits/${draftAuditId}`)
  if (before?.re_audit_of) revalidatePath(`/audits/${before.re_audit_of}`)
  return { ok: true }
}
