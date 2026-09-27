// ============================================================
// SHIKHO QA SYSTEM — weekly audit target computation, production wiring (§9)
// Server-only, service role. compute_weekly_audit_targets() (schema_034) does
// the work; this just calls it. Runs from the daily cron (same job as the
// revenue sync — Hobby allows two cron jobs in all) and idempotently on first
// dashboard load of a week. It only ever writes the CURRENT sales week.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'

export interface TargetsRunResult {
  ok: boolean
  written: number | null
  agentsWithoutRule: number | null
  error: string | null
}

export async function runWeeklyTargetCompute(): Promise<TargetsRunResult> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('compute_weekly_audit_targets')
    if (error) return { ok: false, written: null, agentsWithoutRule: null, error: error.message }
    // schema_035 split the single "written" count into inserted/updated (an update no longer touches the
    // bonus, only base_target) — this still reports their sum for anything that just wants "rows touched".
    const d = (data ?? {}) as { inserted?: number; updated?: number; written?: number; agents_without_a_rule?: number }
    const written = d.inserted !== undefined || d.updated !== undefined ? Number(d.inserted ?? 0) + Number(d.updated ?? 0) : Number(d.written ?? 0)
    return { ok: true, written, agentsWithoutRule: Number(d.agents_without_a_rule ?? 0), error: null }
  } catch (err) {
    return { ok: false, written: null, agentsWithoutRule: null, error: err instanceof Error ? err.message : String(err) }
  }
}
