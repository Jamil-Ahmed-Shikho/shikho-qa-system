// ============================================================
// SHIKHO QA SYSTEM — Extra context for the audit page (§6.3, §8)
// Server-only. Reads only our own tables; access follows the tables' own
// RLS (QA roles see everyone's revenue, a Team Lead/Manager only their
// team/chain), so the numbers a viewer gets are always ones they may see.
//
// REVENUE IS SHOWN IN US DOLLARS. It is stored in BDT; agent_revenue_usd()
// (schema_029) converts EACH sale at the rate in force on that sale's own
// date (currency_rate_at) and sums — never today's rate applied backwards.
//
// PARTIAL DATA, by design of what exists today: revenue is still being
// loaded from the CRM and most of it is not yet matched to an agent, so these
// figures can be LOWER than the real ones. The screen says so; this module just
// reports what is stored.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { previousSalesWeekStartDate, salesWeekStart, salesWeekStartDate } from '@/lib/dates/sales-week'

export interface AgentRevenue {
  /** Last COMPLETED sales week (Sat–Fri), in USD. total is null when that week has no row in agent_weekly_sales — not loaded yet, or the agent wasn't judged that week. */
  lastWeek: { weekStart: string; totalUsd: number | null }
  /** The sales week in progress, in USD, summed live from attributed transactions so far. */
  currentWeek: { weekStart: string; totalUsd: number }
}

/** The USD function (schema_029) isn't in the database yet. */
export class RevenueNeedsMigrationError extends Error {
  constructor() {
    super('Revenue in dollars needs schema_029_revenue_usd.sql to be applied.')
    this.name = 'RevenueNeedsMigrationError'
  }
}

const dhakaMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+06:00`)

/** Throws on a failed read — an error must never look like "no revenue". */
export async function loadAgentRevenue(agentId: string, now: Date = new Date()): Promise<AgentRevenue> {
  const supabase = await getSupabaseServer()
  const lastWeekStart = previousSalesWeekStartDate(now)
  const thisWeekStart = salesWeekStart(now)

  const [weekRow, lastUsd, thisUsd] = await Promise.all([
    // Only to know whether that week was actually computed for this agent (see the field's comment) — the amount is NOT taken from here (it is BDT).
    supabase.from('agent_weekly_sales').select('week_start').eq('agent_id', agentId).eq('week_start', lastWeekStart).maybeSingle(),
    supabase.rpc('agent_revenue_usd', { p_agent_id: agentId, p_from: dhakaMidnight(lastWeekStart).toISOString(), p_to: thisWeekStart.toISOString() }),
    supabase.rpc('agent_revenue_usd', { p_agent_id: agentId, p_from: thisWeekStart.toISOString(), p_to: null }),
  ])
  for (const res of [lastUsd, thisUsd]) {
    if (res.error && /agent_revenue_usd/.test(res.error.message) && /(does not exist|schema cache|could not find)/i.test(res.error.message)) throw new RevenueNeedsMigrationError()
  }
  if (weekRow.error) throw new Error(`Could not read last week's revenue: ${weekRow.error.message}`)
  if (lastUsd.error) throw new Error(`Could not read last week's revenue: ${lastUsd.error.message}`)
  if (thisUsd.error) throw new Error(`Could not read this week's revenue: ${thisUsd.error.message}`)

  return {
    lastWeek: { weekStart: lastWeekStart, totalUsd: weekRow.data ? Number(lastUsd.data) : null },
    currentWeek: { weekStart: salesWeekStartDate(now), totalUsd: Number(thisUsd.data) },
  }
}
