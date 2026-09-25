// ============================================================
// SHIKHO QA SYSTEM — Agent status computation, production wiring (§6.2)
// Server-only, service role. compute_agent_status() (schema_026) does the
// work in the database; this just calls it and reports the outcome. It
// runs from the daily cron (after the revenue sync) — one cron job, not a
// new one, because Vercel Hobby allows only two and the Briefings digest
// needs the other. It is idempotent: the same week's rows are simply
// refreshed each day, and finished weeks are frozen by the function itself.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'

export interface StatusRunResult {
  ok: boolean
  agentsWritten: number | null
  error: string | null
}

export async function runAgentStatusCompute(): Promise<StatusRunResult> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('compute_agent_status')
    if (error) return { ok: false, agentsWritten: null, error: error.message }
    return { ok: true, agentsWritten: Number(data ?? 0), error: null }
  } catch (err) {
    return { ok: false, agentsWritten: null, error: err instanceof Error ? err.message : String(err) }
  }
}
