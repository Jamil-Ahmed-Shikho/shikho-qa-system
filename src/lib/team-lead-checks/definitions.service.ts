// ============================================================
// SHIKHO QA SYSTEM — Team Leader Checks: definitions (schema_057)
// A SEPARATE, TL-only set of checks — not QA's Special Checks (campaigns).
// Super Admin + QA Manager manage; Team Leads read-only (to fill the form).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export interface TlCheckValue {
  id: string
  label: string
  isArchived: boolean
}

export interface TlCheckType {
  id: string
  name: string
  note: string | null
  isArchived: boolean
  values: TlCheckValue[]
}

export function isMissingTlCheckSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /tl_check_types|tl_check_values|team_lead_checks|submit_team_lead_check/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

/** Every check type (archived included), with its values — for the admin screen. */
export async function loadAllTlCheckTypes(): Promise<TlCheckType[]> {
  const supabase = await getSupabaseServer()
  const { data: types, error: typesErr } = await supabase.from('tl_check_types').select('id, name, note, is_archived').order('sort_order')
  if (typesErr) throw new Error(`Could not load check types: ${typesErr.message}`)
  const { data: values, error: valuesErr } = await supabase.from('tl_check_values').select('id, check_type_id, label, is_archived').order('sort_order')
  if (valuesErr) throw new Error(`Could not load check values: ${valuesErr.message}`)

  return (types ?? []).map((t) => ({
    id: t.id, name: t.name, note: t.note, isArchived: t.is_archived,
    values: (values ?? []).filter((v) => v.check_type_id === t.id).map((v) => ({ id: v.id, label: v.label, isArchived: v.is_archived })),
  }))
}

/** Only what's usable RIGHT NOW on the check form — not archived, and with at least one active value. */
export async function loadActiveTlCheckTypes(): Promise<TlCheckType[]> {
  const all = await loadAllTlCheckTypes()
  return all
    .filter((t) => !t.isArchived)
    .map((t) => ({ ...t, values: t.values.filter((v) => !v.isArchived) }))
    .filter((t) => t.values.length >= 2)
}
