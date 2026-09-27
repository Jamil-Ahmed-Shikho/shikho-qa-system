'use server'
// ============================================================
// SHIKHO QA SYSTEM — OJT & Re-Training transitions, server actions (§7)
// Return { ok, error } objects, never throw (§14). The write goes through
// ojt_transition() (schema_038), which is the real gate (Super Admin / QA
// Manager only, validates the state machine); this only gives a friendlier
// message and logs to audit_log. NO EMAIL is sent by anything here.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import type { OjtTransitionTarget } from './ojt.service'

export type ActionResult = { ok: true } | { ok: false; error: string }

function plain(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return 'You are not allowed to do that.'
  return message
}

export async function ojtTransitionAction(
  agentId: string,
  to: OjtTransitionTarget,
  note: string,
  joiningDate: string | null,
  retrainStart: string | null
): Promise<ActionResult> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (!['super_admin', 'qa_manager'].includes(user.role)) {
      return { ok: false, error: 'Only a Super Admin or QA Manager can change an OJT candidate\'s stage.' }
    }
    if (note.length > 1000) return { ok: false, error: 'The note can be at most 1000 characters.' }

    const supabase = await getSupabaseServer()
    const { error } = await supabase.rpc('ojt_transition', {
      p_agent_id: agentId,
      p_to_stage: to,
      p_note: note.trim() || null,
      p_joining_date: joiningDate,
      p_retrain_start: retrainStart,
    })
    if (error) return { ok: false, error: plain(error.message) }

    await writeAuditLogs([{
      actor_id: user.profile.id,
      action: 'ojt.transition',
      table_name: 'ojt_status_history',
      record_id: agentId,
      after_data: { to, note: note.trim() || null, joining_date: joiningDate, retrain_start: retrainStart },
    }])
    revalidatePath('/admin/ojt')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}
