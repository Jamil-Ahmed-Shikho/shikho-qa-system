// ============================================================
// SHIKHO QA SYSTEM — Holiday calendar (§9.4)
// Server-only. Simple admin CRUD (RLS is the boundary, schema_063) — not
// versioned, since editing a holiday never rewrites a past, already-frozen
// sales week (compute_weekly_audit_targets only ever touches the CURRENT
// week, same principle used throughout this system).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { DayException } from '@/lib/briefings/rules'

export type HolidayKind = 'holiday' | 'working_day'

export interface HolidayRow {
  id: string
  date: string // 'YYYY-MM-DD'
  name: string
  note: string | null
  siteName: string | null // null = every site
  kind: HolidayKind
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
    .select('id, holiday_date, name, note, site_name, kind, created_at')
    .order('holiday_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.holiday_date as string,
    name: r.name as string,
    note: r.note as string | null,
    siteName: r.site_name as string | null,
    kind: r.kind as HolidayKind,
    createdAt: r.created_at as string,
  }))
}

/** Day-swap overrides (schema_098) in [from, to) applying to `siteName` (or every site) — for the
 *  Briefings scheduler, which needs "is this date open" for one auditor's own site. Collapses to at
 *  most one entry per date: a site-specific row wins over an all-sites row for the same date,
 *  mirroring the enforce_briefing_day_open trigger's own precedence. */
export async function loadHolidayExceptions(from: string, to: string, siteName: string | null): Promise<DayException[]> {
  const supabase = await getSupabaseServer()
  let query = supabase.from('holidays').select('holiday_date, kind, site_name').gte('holiday_date', from).lt('holiday_date', to)
  query = siteName ? query.or(`site_name.eq.${siteName},site_name.is.null`) : query.is('site_name', null)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const byDate = new Map<string, { kind: HolidayKind; specific: boolean }>()
  for (const r of data ?? []) {
    const specific = r.site_name !== null
    const existing = byDate.get(r.holiday_date as string)
    if (!existing || (specific && !existing.specific)) {
      byDate.set(r.holiday_date as string, { kind: r.kind as HolidayKind, specific })
    }
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, kind: v.kind }))
}
