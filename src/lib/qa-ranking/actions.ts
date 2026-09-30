'use server'

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export async function setCoachingTargetAction(weeklyTarget: number): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return { ok: false, error: 'Only a Super Admin or QA Manager can set the coaching target.' }
  }
  if (!Number.isInteger(weeklyTarget) || weeklyTarget <= 0) {
    return { ok: false, error: 'The weekly coaching target must be a positive whole number.' }
  }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('set_qa_coaching_target', { p_weekly_target: weeklyTarget })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/qa-auditor-ranking')
  return { ok: true }
}
