// ============================================================
// SHIKHO QA SYSTEM — Extra context for the audit page (§6.3, §8)
// Server-only. Reads only our own tables; access follows the tables' own
// RLS (QA roles see everyone's revenue, a Team Lead/Manager only their
// team/chain), so the numbers a viewer gets are always ones they may see.
//
// PARTIAL DATA, by design of what exists today: revenue is still being
// loaded from the CRM (the 12-month backfill is unfinished) and most of it
// is not yet matched to an agent, so these figures can be LOWER than the
// real ones. The screen says so; this module just reports what is stored.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { previousSalesWeekStartDate, salesWeekStart, salesWeekStartDate } from '@/lib/dates/sales-week'

export interface AgentRevenue {
  /** Last COMPLETED sales week (Sat–Fri). total is null when that week has no row in agent_weekly_sales — not loaded yet, or the agent wasn't judged that week. */
  lastWeek: { weekStart: string; total: number | null }
  /** The sales week in progress, summed live from attributed transactions so far. */
  currentWeek: { weekStart: string; total: number }
}

/** Throws on a failed read — an error must never look like "no revenue". */
export async function loadAgentRevenue(agentId: string, now: Date = new Date()): Promise<AgentRevenue> {
  const supabase = await getSupabaseServer()
  const lastWeekStart = previousSalesWeekStartDate(now)

  const [lastWeekRes, currentRes] = await Promise.all([
    supabase.from('agent_weekly_sales').select('total_revenue').eq('agent_id', agentId).eq('week_start', lastWeekStart).maybeSingle(),
    supabase.from('agent_revenue_transactions').select('revenue_amount').eq('agent_id', agentId).gte('purchase_created_at', salesWeekStart(now).toISOString()),
  ])
  if (lastWeekRes.error) throw new Error(`Could not read last week's revenue: ${lastWeekRes.error.message}`)
  if (currentRes.error) throw new Error(`Could not read this week's revenue: ${currentRes.error.message}`)

  return {
    lastWeek: {
      weekStart: lastWeekStart,
      total: lastWeekRes.data ? Number(lastWeekRes.data.total_revenue) : null,
    },
    currentWeek: {
      weekStart: salesWeekStartDate(now),
      total: (currentRes.data ?? []).reduce((sum, r) => sum + Number(r.revenue_amount), 0),
    },
  }
}
