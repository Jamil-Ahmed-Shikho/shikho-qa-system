'use server'
// ============================================================
// SHIKHO QA SYSTEM — holiday server actions (§9.4)
// Return { ok, error } objects, never throw (§14). RLS (schema_063)
// restricts writes to Super Admin / QA Manager — the role check here
// only gives a friendlier message.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'

export interface HolidayInput {
  date: string // 'YYYY-MM-DD'
  name: string
  note: string | null
  site: string | null // null = every site
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function addHolidayAction(input: HolidayInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (!['super_admin', 'qa_manager'].includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can manage the holiday calendar.' }
    if (!DATE_RE.test(input.date)) return { ok: false, error: 'Choose a date.' }
    const name = input.name.trim()
    if (!name) return { ok: false, error: 'Give the holiday a name.' }
    if (name.length > 100) return { ok: false, error: 'The name is too long (100 characters max).' }
    const note = input.note?.trim() || null
    if (note && note.length > 500) return { ok: false, error: 'The note is too long (500 characters max).' }

    const supabase = await getSupabaseServer()
    const { data, error } = await supabase
      .from('holidays')
      .insert({ holiday_date: input.date, name, note, site_name: input.site, created_by: user.profile.id })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return { ok: false, error: `${input.site ?? 'All sites'} already has a holiday marked on ${input.date}.` }
      return { ok: false, error: error.message }
    }
    await writeAuditLogs([{ actor_id: user.profile.id, action: 'holiday.added', table_name: 'holidays', record_id: data.id, after_data: { date: input.date, name, site: input.site } }])
    revalidatePath('/admin/holidays')
    return { ok: true, id: data.id as string }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}

export async function removeHolidayAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (!['super_admin', 'qa_manager'].includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can manage the holiday calendar.' }

    const supabase = await getSupabaseServer()
    const { data: existing } = await supabase.from('holidays').select('holiday_date, name, site_name').eq('id', id).maybeSingle()
    const { error } = await supabase.from('holidays').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await writeAuditLogs([{ actor_id: user.profile.id, action: 'holiday.removed', table_name: 'holidays', record_id: id, before_data: existing ?? null }])
    revalidatePath('/admin/holidays')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}
