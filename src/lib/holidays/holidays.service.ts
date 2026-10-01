// ============================================================
// SHIKHO QA SYSTEM — Holiday calendar (§9.4)
// Server-only. Simple admin CRUD (RLS is the boundary, schema_063) — not
// versioned, since editing a holiday never rewrites a past, already-frozen
// sales week (compute_weekly_audit_targets only ever touches the CURRENT
// week, same principle used throughout this system).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export interface HolidayRow {
  id: string
  date: string // 'YYYY-MM-DD'
  name: string
  note: string | null
  siteName: string | null // null = every site
  createdAt: string
}

/** True when a failed read/write looks like "schema_063 isn't applied yet". */
export function isMissingHolidaysSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /holidays/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export async function loadHolidays(): Promise<HolidayRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('holidays')
    .select('id, holiday_date, name, note, site_name, created_at')
    .order('holiday_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.holiday_date as string,
    name: r.name as string,
    note: r.note as string | null,
    siteName: r.site_name as string | null,
    createdAt: r.created_at as string,
  }))
}
