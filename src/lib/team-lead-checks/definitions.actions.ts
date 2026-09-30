'use server'

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'

export type ActionResult = { ok: true } | { ok: false; error: string }

async function requireAdmin() {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    throw new Error('Only a Super Admin or QA Manager can manage Team Leader Checks.')
  }
  return user
}

function friendly(message: string): string {
  if (/uq_tl_check_types_name/i.test(message)) return 'A check with this name already exists.'
  if (/uq_tl_check_values_label/i.test(message)) return 'This option already exists for this check.'
  return message
}

export async function addTlCheckTypeAction(name: string, note: string | null): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Give the check a name.' }
  const supabase = await getSupabaseServer()
  const { data: existing } = await supabase.from('tl_check_types').select('sort_order').order('sort_order', { ascending: false }).limit(1)
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1
  const { error } = await supabase.from('tl_check_types').insert({ name: trimmed, note: note?.trim() || null, sort_order: nextOrder })
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath('/admin/team-lead-checks')
  return { ok: true }
}

export async function setTlCheckTypeArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('tl_check_types').update({ is_archived: archived }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/team-lead-checks')
  return { ok: true }
}

export async function addTlCheckValueAction(checkTypeId: string, label: string): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const trimmed = label.trim()
  if (!trimmed) return { ok: false, error: 'Give the option a label.' }
  const supabase = await getSupabaseServer()
  const { data: existing } = await supabase.from('tl_check_values').select('sort_order').eq('check_type_id', checkTypeId).order('sort_order', { ascending: false }).limit(1)
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1
  const { error } = await supabase.from('tl_check_values').insert({ check_type_id: checkTypeId, label: trimmed, sort_order: nextOrder })
  if (error) return { ok: false, error: friendly(error.message) }
  revalidatePath('/admin/team-lead-checks')
  return { ok: true }
}

export async function setTlCheckValueArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  try {
    await requireAdmin()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('tl_check_values').update({ is_archived: archived }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/team-lead-checks')
  return { ok: true }
}
