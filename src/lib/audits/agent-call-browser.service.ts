// ============================================================
// SHIKHO QA SYSTEM — Agent-scoped call browser (§9/§10, Part 2)
// Server-only. The agent is already known (the queue's Audit button, or a
// direct link); this loads that agent's CRM calls, filtered, WITHOUT a lead
// ID in hand — the manual lead lookup (§10, Part v1) stays available
// alongside this, unchanged.
//
// MATCHING (confirmed by Jamil, 2026-09-27): reuses the existing
// profile-email -> CRM-id lookup, i.e. `users.crm_agent_id` (§10's
// agent-matching pipeline caches it the first time one of the agent's
// calls is matched from a LEAD lookup). An agent with no cached id yet has
// no way in here — they need one call resolved via the manual lead lookup
// first, which is what the "not matched" state below tells the auditor.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { getCallsForAgent, getLeadStages, getLeadSummary, CrmApiError, type CrmLeadStage } from '@/lib/crm/client'
import { getCallStatusMap, type CallStatusEntry } from './audits.service'
import type { CrmCallingHistory } from '@/lib/crm/types'
import { DEFAULT_FILTERS, PAGE_SIZE, type AgentCallFilters } from '@/lib/crm/agent-calls'

export interface BrowsableAgent {
  id: string
  name: string
  email: string
  teamName: string | null
  siteName: string | null
  crmAgentId: number | null
}

/** The agent to browse calls for. Null if no such active agent. */
export async function loadBrowsableAgent(agentUserId: string): Promise<BrowsableAgent | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, team_name, site_name, crm_agent_id, role, is_active')
    .eq('id', agentUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.role !== 'agent') return null
  return { id: data.id, name: data.name, email: data.email, teamName: data.team_name, siteName: data.site_name, crmAgentId: data.crm_agent_id }
}

export interface AgentCallRow {
  call: CrmCallingHistory
  status: CallStatusEntry | null
  /** The lead's CURRENT distribution list (same source as the filter field, §10) — null = none set, undefined = couldn't load. */
  distributionList: string | null | undefined
}

/**
 * `calling-histories` never embeds the lead object, even when filtered through it (confirmed live 2026-09-27 —
 * the same finding as §10's "no nested lead object"), so the Distribution List column needs one lookup per
 * DISTINCT lead on the page (a repeat lead — the agent called it more than once — is looked up only once).
 * A failure on one lead never fails the page; that row just shows "couldn't load" (undefined, never a silent "—").
 */
async function loadDistributionLists(leadIds: number[], actorId: string): Promise<Map<number, string | null>> {
  const distinct = [...new Set(leadIds)]
  const pairs = await Promise.all(
    distinct.map(async (id): Promise<[number, string | null] | null> => {
      try {
        const lead = await getLeadSummary(id, actorId)
        return [id, lead?.distributionList ?? null]
      } catch {
        return null // left out of the map entirely -> the row renders "couldn't load"
      }
    })
  )
  return new Map(pairs.filter((p): p is [number, string | null] => p !== null))
}

export interface AgentCallPage {
  rows: AgentCallRow[]
  nextCursor: number | null
  leadStages: CrmLeadStage[]
}

/** True when a failed CRM read is a reachability problem, not "no results". */
export function isCrmUnreachable(err: unknown): boolean {
  return !(err instanceof CrmApiError) || err.status === undefined || err.status >= 500
}

export async function loadAgentCallPage(
  agent: BrowsableAgent,
  filters: AgentCallFilters,
  beforeId: number | null,
  actorId: string
): Promise<AgentCallPage> {
  if (agent.crmAgentId === null) return { rows: [], nextCursor: null, leadStages: [] }

  // Ask for one more than a page so we know whether there's a next page, without a COUNT query the CRM doesn't offer.
  const [calls, leadStages] = await Promise.all([
    getCallsForAgent(agent.crmAgentId, filters, beforeId, PAGE_SIZE + 1, actorId),
    getLeadStages(actorId).catch(() => [] as CrmLeadStage[]), // the filter dropdown degrades to free entry; never blocks the list
  ])
  const hasMore = calls.length > PAGE_SIZE
  const page = hasMore ? calls.slice(0, PAGE_SIZE) : calls
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const [statusMap, distMap] = await Promise.all([
    getCallStatusMap(page.map((c) => String(c.id))),
    loadDistributionLists(page.map((c) => c.lead_id), actorId),
  ])
  const rows: AgentCallRow[] = page.map((call) => ({
    call,
    status: statusMap.get(String(call.id)) ?? null,
    distributionList: distMap.has(call.lead_id) ? distMap.get(call.lead_id)! : undefined,
  }))
  return { rows, nextCursor, leadStages }
}

export { DEFAULT_FILTERS }

/** Parses the page's searchParams into filters, falling back to the confirmed defaults for anything missing. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): AgentCallFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const status = one(sp.status)
  const duration = one(sp.duration)
  const range = one(sp.range)
  const validRange = range === 'today' || range === 'yesterday' || range === 'current_week' || range === 'current_month' || range === 'custom'
  return {
    status: status === '' ? null : (status ?? DEFAULT_FILTERS.status),
    minDurationSeconds: duration !== undefined ? (Number(duration) >= 0 ? Number(duration) : DEFAULT_FILTERS.minDurationSeconds) : DEFAULT_FILTERS.minDurationSeconds,
    leadStageId: one(sp.stage)?.trim() || null,
    distributionList: one(sp.dist)?.trim() || null,
    range: validRange ? range : DEFAULT_FILTERS.range,
    customFrom: one(sp.from) || null,
    customTo: one(sp.to) || null,
  }
}
