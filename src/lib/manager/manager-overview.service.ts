// ============================================================
// SHIKHO QA SYSTEM — Manager dashboard: Fatal incidents / Zero-Seller /
// PIP live progress for a Manager's own chain. Parity with the Team Lead
// dashboard (team-lead-dashboard.service.ts) and the QA Manager/Auditor
// report (qa-overview.service.ts) — same three sections, same detail
// (Jamil, 2026-10-11/12: "is this implemented to other places... build
// the same section for the Manager dashboard too").
//
// Takes an EXPLICIT agentIds list — the one getManagerDashboard() already
// resolves via manager_agent_stats(), which correctly scopes to the
// requested manager whether the viewer is that manager themself or an
// admin browsing someone else's chain. Relying on the signed-in session's
// own RLS scoping instead (the way the Team Lead dashboard safely can,
// since a Team Lead never browses someone else's team) would be wrong
// here: an admin browsing a SPECIFIC other manager's chain has
// unrestricted RLS, so implicit session scoping would silently show
// company-wide data instead of just that manager's chain — the exact trap
// already flagged on /dashboard/manager/page.tsx for the Briefings section.
//
// A Manager cannot open /audits/{id} (excluded from that route's
// ROLE_ROUTES, §9 Part 2 — "a Manager doesn't audit calls"), so unlike the
// Team Lead and QA versions, there is no per-audit link here — only the
// agent-profile link (/dashboard/manager/agent/{id}, already Manager-safe).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { agentVintage, DEFAULT_VINTAGE_SLABS, type Vintage } from '@/lib/agents/vintage'
import { loadVintageSlabs } from '@/lib/agents/vintage.service'
import { dhakaDateStartUtc, dhakaDateEndUtc } from '@/lib/dates/sales-week'

export interface ManagerFatalIncidentRow {
  auditId: string
  agentId: string
  agentName: string
  auditorName: string | null
  submittedAt: string
  fatalParameters: string[]
  lifetimeFatalCount: number
}

export interface ManagerZeroSellerRow {
  agentId: string
  agentName: string
  vintage: Vintage
  currentStreakWeeks: number
  lastSaleDate: string | null
  daysSinceLastSale: number | null
  lastSaleRevenueUsd: number | null
}

export interface ManagerPipLiveRow {
  /** pip_candidates.id — links straight to /pip/{candidateId}, 2026-10-12. */
  candidateId: string
  agentId: string
  agentName: string
  targetUsd: number | null
  achievedUsd: number
  remainingUsd: number | null
  daysLeft: number
  runRateRequiredUsdPerDay: number | null
  targetMet: boolean | null
  lastSaleDate: string | null
}

export interface ManagerOverview {
  fatalIncidents: ManagerFatalIncidentRow[]
  zeroSellers: ManagerZeroSellerRow[]
  pipLive: ManagerPipLiveRow[]
}

export async function loadManagerOverview(agentIds: string[], from: Date, to: Date): Promise<ManagerOverview> {
  if (agentIds.length === 0) return { fatalIncidents: [], zeroSellers: [], pipLive: [] }
  const supabase = await getSupabaseServer()

  const [slabs, rosterRes, zeroSellerRes, fatalsRes, cycleRes] = await Promise.all([
    loadVintageSlabs().catch(() => DEFAULT_VINTAGE_SLABS),
    supabase.from('users').select('id, name, employment_stage, joining_date').in('id', agentIds),
    supabase.from('agent_zero_seller_status').select('agent_id, current_streak_weeks, last_sale_date').in('agent_id', agentIds).gt('current_streak_weeks', 0),
    // check_mode = 'audit' — a Sample Check never carries critical_fail=true, but stays explicit
    // for consistency with every other "is this a real audit" filter in this system.
    supabase.from('audits').select('id, agent_id, auditor_id, submitted_at').eq('status', 'submitted').eq('check_mode', 'audit').eq('critical_fail', true).in('agent_id', agentIds)
      .gte('submitted_at', from.toISOString()).lt('submitted_at', to.toISOString()),
    supabase.from('pip_cycles').select('id, start_date, end_date')
      .lte('start_date', new Date().toISOString().slice(0, 10)).gte('end_date', new Date().toISOString().slice(0, 10)).maybeSingle(),
  ])
  if (rosterRes.error) throw new Error(`Could not load your chain's agents: ${rosterRes.error.message}`)
  if (zeroSellerRes.error) throw new Error(`Could not load zero-seller status: ${zeroSellerRes.error.message}`)
  if (fatalsRes.error) throw new Error(`Could not load fatal incidents: ${fatalsRes.error.message}`)

  const rosterById = new Map((rosterRes.data ?? []).map((a) => [a.id, a]))
  const vintageByAgent = new Map(
    (rosterRes.data ?? []).map((a) => [a.id, agentVintage({ employment_stage: a.employment_stage, joining_date: a.joining_date }, slabs)])
  )

  const auditorIds = [...new Set((fatalsRes.data ?? []).map((a) => a.auditor_id).filter(Boolean))] as string[]
  const auditorNames = new Map<string, string>()
  if (auditorIds.length > 0) {
    const { data } = await supabase.from('users').select('id, name').in('id', auditorIds)
    for (const u of data ?? []) auditorNames.set(u.id, u.name)
  }

  // Which fatal item(s) were ticked on each incident, and each agent's lifetime fatal count — same
  // enrichment as the Team Lead dashboard and the QA Manager/Auditor report.
  type OneOrMany<T> = T | T[] | null
  const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const fatalAuditIds = (fatalsRes.data ?? []).map((f) => f.id)
  const fatalAgentIds = [...new Set((fatalsRes.data ?? []).map((f) => f.agent_id))]
  const [fatalParamsRes, lifetimeFatalsRes] = await Promise.all([
    fatalAuditIds.length > 0
      ? supabase.from('audit_fatal_results').select('audit_id, fatal_parameters(description)').in('audit_id', fatalAuditIds)
      : Promise.resolve({ data: [] as { audit_id: string; fatal_parameters: OneOrMany<{ description: string }> }[], error: null }),
    fatalAgentIds.length > 0
      ? supabase.from('audits').select('agent_id').eq('status', 'submitted').eq('check_mode', 'audit').eq('critical_fail', true).in('agent_id', fatalAgentIds)
      : Promise.resolve({ data: [] as { agent_id: string }[], error: null }),
  ])
  if (fatalParamsRes.error) throw new Error(`Could not load fatal parameter detail: ${fatalParamsRes.error.message}`)
  if (lifetimeFatalsRes.error) throw new Error(`Could not load lifetime fatal counts: ${lifetimeFatalsRes.error.message}`)

  const fatalParamsByAudit = new Map<string, string[]>()
  for (const row of fatalParamsRes.data ?? []) {
    const desc = one(row.fatal_parameters as OneOrMany<{ description: string }>)?.description
    if (!desc) continue
    const list = fatalParamsByAudit.get(row.audit_id) ?? []
    list.push(desc)
    fatalParamsByAudit.set(row.audit_id, list)
  }
  const lifetimeFatalByAgent = new Map<string, number>()
  for (const row of lifetimeFatalsRes.data ?? []) {
    lifetimeFatalByAgent.set(row.agent_id, (lifetimeFatalByAgent.get(row.agent_id) ?? 0) + 1)
  }

  const fatalIncidents: ManagerFatalIncidentRow[] = (fatalsRes.data ?? []).map((f) => ({
    auditId: f.id, agentId: f.agent_id, agentName: rosterById.get(f.agent_id)?.name ?? 'Unknown',
    auditorName: f.auditor_id ? auditorNames.get(f.auditor_id) ?? null : null, submittedAt: f.submitted_at,
    fatalParameters: fatalParamsByAudit.get(f.id) ?? [], lifetimeFatalCount: lifetimeFatalByAgent.get(f.agent_id) ?? 0,
  }))

  // Last sale date is a Dhaka calendar date, not a known transaction — sum whatever was attributed
  // on that day (agent_revenue_usd), same reasoning as the Team Lead dashboard.
  const zeroSellerRevenueByAgent = new Map<string, number | null>(
    await Promise.all(
      (zeroSellerRes.data ?? []).map(async (z): Promise<[string, number | null]> => {
        if (!z.last_sale_date) return [z.agent_id, null]
        const { data: rev } = await supabase.rpc('agent_revenue_usd', {
          p_agent_id: z.agent_id,
          p_from: dhakaDateStartUtc(z.last_sale_date).toISOString(),
          p_to: dhakaDateEndUtc(z.last_sale_date).toISOString(),
        })
        return [z.agent_id, rev === null || rev === undefined ? null : Number(rev)]
      })
    )
  )

  const nowMs = Date.now()
  const zeroSellers: ManagerZeroSellerRow[] = (zeroSellerRes.data ?? [])
    .map((z) => ({
      agentId: z.agent_id,
      agentName: rosterById.get(z.agent_id)?.name ?? 'Unknown',
      vintage: vintageByAgent.get(z.agent_id) ?? { label: 'Not available', detail: null, days: null },
      currentStreakWeeks: z.current_streak_weeks,
      lastSaleDate: z.last_sale_date,
      daysSinceLastSale: z.last_sale_date ? Math.floor((nowMs - dhakaDateStartUtc(z.last_sale_date).getTime()) / 86_400_000) : null,
      lastSaleRevenueUsd: zeroSellerRevenueByAgent.get(z.agent_id) ?? null,
    }))
    .sort((a, b) => b.currentStreakWeeks - a.currentStreakWeeks)

  // PIP: only the cycle covering today, only this chain's approved candidates.
  let pipLive: ManagerPipLiveRow[] = []
  const cycle = cycleRes.data as { id: string; start_date: string; end_date: string } | null
  if (cycle) {
    const { data: candidates, error: candErr } = await supabase
      .from('pip_candidates').select('id, agent_id, target_revenue')
      .eq('pip_cycle_id', cycle.id).eq('status', 'approved').in('agent_id', agentIds)
    if (candErr) throw new Error(`Could not load PIP progress: ${candErr.message}`)
    const cycleStart = dhakaDateStartUtc(cycle.start_date)
    const cycleEndExclusive = dhakaDateEndUtc(cycle.end_date)
    const cappedEnd = new Date(Math.min(Date.now(), cycleEndExclusive.getTime()))
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
    const endDate = new Date(cycle.end_date + 'T00:00:00')
    const daysLeft = Math.max(0, Math.round((endDate.getTime() - today.getTime()) / 86_400_000))

    const pipCandidateIds = (candidates ?? []).map((c) => c.agent_id)
    const lastSaleByAgent = new Map<string, string | null>()
    if (pipCandidateIds.length > 0) {
      const { data: lastSales, error: lastSaleErr } = await supabase
        .from('agent_zero_seller_status').select('agent_id, last_sale_date').in('agent_id', pipCandidateIds)
      if (lastSaleErr) throw new Error(`Could not load last-sale dates for PIP: ${lastSaleErr.message}`)
      for (const row of lastSales ?? []) lastSaleByAgent.set(row.agent_id, row.last_sale_date)
    }

    pipLive = await Promise.all(
      (candidates ?? []).map(async (c) => {
        const { data: rev } = await supabase.rpc('agent_revenue_usd', { p_agent_id: c.agent_id, p_from: cycleStart.toISOString(), p_to: cappedEnd.toISOString() })
        const achieved = Number(rev ?? 0)
        const target = c.target_revenue
        const targetMet = target === null ? null : achieved >= target
        return {
          candidateId: c.id,
          agentId: c.agent_id, agentName: rosterById.get(c.agent_id)?.name ?? 'Unknown', targetUsd: target, achievedUsd: achieved, daysLeft,
          remainingUsd: target !== null ? Math.max(0, Math.round((target - achieved) * 100) / 100) : null,
          runRateRequiredUsdPerDay: target !== null && !targetMet ? Math.round(((target - achieved) / Math.max(daysLeft, 1)) * 100) / 100 : null,
          targetMet,
          lastSaleDate: lastSaleByAgent.get(c.agent_id) ?? null,
        }
      })
    )
  }

  return { fatalIncidents, zeroSellers, pipLive }
}
