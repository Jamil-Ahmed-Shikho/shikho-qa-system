// ============================================================
// SHIKHO QA SYSTEM — weekly audit target computation, production wiring (§9)
// Server-only, service role. compute_weekly_audit_targets() (schema_034) does
// the work; this just calls it. Runs from the daily cron (same job as the
// revenue sync — Hobby allows two cron jobs in all) and idempotently on first
// dashboard load of a week. It only ever writes the CURRENT sales week.
//
// THROTTLED (2026-10-10, Vercel Hobby Active CPU reduction): loadQueue() used
// to call this unconditionally on EVERY dashboard load (schema_034/035's own
// note: "an admin's rule change dated 'current' still applies within the
// week in progress"), which meant a bulk upsert over every eligible agent
// ran on every single page view of /dashboard/auditor, /dashboard/team and
// /dashboard/manager — not just once a week. unstable_cache throttles real
// recomputes to once every TARGETS_RECOMPUTE_REVALIDATE_SECONDS, SHARED
// globally across every caller (one throttle for the whole app, not per
// user) — the DB function is idempotent and only ever touches the current
// week, so skipping a re-run for up to that long changes nothing most of
// the time. An admin's same-week rule edit is still "current" within the
// week in progress, just up to that many seconds slower to actually show on
// a dashboard — inside Jamil's own stated "1-5 minutes is fine" tolerance.
// Keyed by the current sales week (salesWeekStartDate) so a cached result
// can never bleed into a new week even if nothing reads this for a while —
// the revalidate window alone would already self-correct within it, this
// just keeps the cache key meaningful.
// ============================================================

import { unstable_cache } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { salesWeekStartDate } from '@/lib/dates/sales-week'

export interface TargetsRunResult {
  ok: boolean
  written: number | null
  agentsWithoutRule: number | null
  error: string | null
}

async function computeWeeklyTargetsNow(_weekStart: string): Promise<TargetsRunResult> {
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

const TARGETS_RECOMPUTE_REVALIDATE_SECONDS = 120

const runCachedCompute = unstable_cache(computeWeeklyTargetsNow, ['weekly-target-compute'], {
  revalidate: TARGETS_RECOMPUTE_REVALIDATE_SECONDS,
})

export async function runWeeklyTargetCompute(): Promise<TargetsRunResult> {
  return runCachedCompute(salesWeekStartDate(new Date()))
}
