// ============================================================
// SHIKHO QA SYSTEM — Team Leader Checks: the agent-scoped call browser
// (schema_057). Reuses the SAME CRM plumbing as the real audit call
// browser (§9/§10 Part 2, `agent-call-browser.service.ts`) — filters, lead
// stages, distribution lists, pagination — but its own status source
// (`team_lead_checks`, never `audits`), kept deliberately separate rather
// than widening the audit one (§14 — don't widen a shared helper for one
// caller's sake).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { getCallsForAgent, getLeadStages, type CrmLeadStage } from '@/lib/crm/client'
import { loadDistributionLists, type BrowsableAgent } from '@/lib/audits/agent-call-browser.service'
import type { CrmCallingHistory } from '@/lib/crm/types'
import { DEFAULT_FILTERS, PAGE_SIZE, type AgentCallFilters } from '@/lib/crm/agent-calls'

export { DEFAULT_FILTERS, loadBrowsableAgent, parseFilters, isCrmUnreachable } from '@/lib/audits/agent-call-browser.service'
export type { BrowsableAgent } from '@/lib/audits/agent-call-browser.service'

export interface TlCheckStatusEntry {
  checkId: string
  createdAt: string
}

async function getTlCheckStatusMap(crmCallIds: string[]): Promise<Map<string, TlCheckStatusEntry>> {
  const result = new Map<string, TlCheckStatusEntry>()
  if (crmCallIds.length === 0) return result
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('team_lead_checks').select('id, crm_call_id, created_at').in('crm_call_id', crmCallIds)
  if (error) throw new Error(error.message)
  for (const row of data ?? []) result.set(row.crm_call_id as string, { checkId: row.id, createdAt: row.created_at })
  return result
}

export interface TlCheckCallRow {
  call: CrmCallingHistory
  status: TlCheckStatusEntry | null
  distributionList: string | null | undefined
}

export interface TlCheckCallPage {
  rows: TlCheckCallRow[]
  nextCursor: number | null
  leadStages: CrmLeadStage[]
}

export async function loadTlCheckCallPage(
  agent: BrowsableAgent,
  filters: AgentCallFilters,
  beforeId: number | null,
  actorId: string
): Promise<TlCheckCallPage> {
  if (agent.crmAgentId === null) return { rows: [], nextCursor: null, leadStages: [] }

  const [calls, leadStages] = await Promise.all([
    getCallsForAgent(agent.crmAgentId, filters, beforeId, PAGE_SIZE + 1, actorId),
    getLeadStages(actorId).catch(() => [] as CrmLeadStage[]),
  ])
  const hasMore = calls.length > PAGE_SIZE
  const page = hasMore ? calls.slice(0, PAGE_SIZE) : calls
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const [statusMap, distMap] = await Promise.all([
    getTlCheckStatusMap(page.map((c) => String(c.id))),
    loadDistributionLists(page.map((c) => c.lead_id), actorId),
  ])
  const rows: TlCheckCallRow[] = page.map((call) => ({
    call,
    status: statusMap.get(String(call.id)) ?? null,
    distributionList: distMap.has(call.lead_id) ? distMap.get(call.lead_id)! : undefined,
  }))
  return { rows, nextCursor, leadStages }
}
