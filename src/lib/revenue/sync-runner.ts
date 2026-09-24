// ============================================================
// SHIKHO QA SYSTEM — Daily revenue sync: production wiring (§8, Part C)
// Server-only. Connects runRevenueSync() (src/lib/revenue/sync.ts, the
// tested rules) to the real CRM, the real matching pipeline and Supabase.
// Everything here runs with the service role — no signed-in user is
// behind a cron call.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAgentForCall } from '@/lib/audits/agent-matching'
import { getEventsWindow } from '@/lib/crm/client'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { DEFAULT_SYNC_CONFIG, runRevenueSync, type StoredRow, type SyncDeps, type SyncResult } from './sync'

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function runDailyRevenueSync(): Promise<SyncResult> {
  const admin = getSupabaseAdmin()
  const cfg = DEFAULT_SYNC_CONFIG

  const deps: SyncDeps = {
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fetchPage: (page, limit) => getEventsWindow(cfg.windowDays, page, limit, null),

    // The app's existing matching pipeline, unchanged (no new matching
    // logic — §8). It already reports a CRM lookup FAILURE separately from
    // "no such person", which is exactly the distinction guardrail 2 needs.
    resolveOwner: async (crmUserId, name) => {
      const res = await resolveAgentForCall({ id: crmUserId, name: name ?? '' }, null, admin as unknown as SupabaseClient)
      if (res.match) return { kind: 'matched', agentId: res.match.id }
      return { kind: res.crm.lookupFailed ? 'failed' : 'unmatched' }
    },

    store: {
      async loadWindowRows(fromIso) {
        return selectAll<StoredRow>((from, to) =>
          admin
            .from('agent_revenue_transactions')
            .select('crm_event_id, agent_id, lead_owner_crm_id')
            .gte('purchase_created_at', fromIso)
            .order('crm_event_id')
            .range(from, to)
        )
      },
      async loadUserIdsByCrmId() {
        const users = await selectAll<{ id: string; crm_agent_id: number }>((from, to) =>
          admin.from('users').select('id, crm_agent_id').not('crm_agent_id', 'is', null).order('id').range(from, to)
        )
        return new Map(users.map((u) => [Number(u.crm_agent_id), u.id]))
      },
      async upsertRows(rows) {
        const { error } = await admin.from('agent_revenue_transactions').upsert(rows, { onConflict: 'crm_event_id' })
        if (error) throw new Error(`Upsert failed: ${error.message}`)
      },
      async flagMissing(runStartedIso, windowFromIso) {
        const { data, error } = await admin.rpc('flag_missing_revenue_events', {
          p_run_started: runStartedIso,
          p_window_from: windowFromIso,
        })
        if (error) throw new Error(`Flagging missing events failed: ${error.message}`)
        return Number(data ?? 0)
      },
      async recomputeWeeklySales() {
        const { data, error } = await admin.rpc('recompute_weekly_sales')
        if (error) throw new Error(error.message)
        return data
      },
      async writeState(patch) {
        const { error } = await admin.from('revenue_sync_state').upsert({ id: 'daily', ...patch })
        // The state row IS the failure channel; if it can't be written, say so loudly.
        if (error) console.error('revenue_sync_state write failed:', error.message)
      },
    },
  }

  return runRevenueSync(deps, cfg)
}
