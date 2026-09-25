// ============================================================
// SHIKHO QA SYSTEM — Vintage slabs loader (§6.1)
// Server-only. Reads the CURRENT slab set. If it can't be read (most
// commonly: schema_025 not applied yet) it falls back to the built-in
// defaults — the same values the migration seeds — and says so in the
// server log, so a screen showing a vintage never fails because of it.
// ============================================================

import { cache } from 'react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { DEFAULT_VINTAGE_SLABS, type VintageSlab } from './vintage'

export const loadVintageSlabs = cache(async (): Promise<VintageSlab[]> => {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('vintage_slabs')
    .select('label, min_days, max_days, sort_order')
    .is('effective_to', null)
    .order('sort_order')
  if (error || !data || data.length === 0) {
    console.warn(`Vintage slabs not readable (${error?.message ?? 'no current rows'}) — using the built-in defaults.`)
    return DEFAULT_VINTAGE_SLABS
  }
  return data.map((r) => ({ label: r.label as string, minDays: r.min_days as number | null, maxDays: r.max_days as number | null }))
})
