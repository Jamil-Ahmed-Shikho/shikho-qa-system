// ============================================================
// SHIKHO QA SYSTEM — Team Lead dashboard (§11)
// Server-only. Every query here runs through the SIGNED-IN Team Lead's own
// session — no new SECURITY DEFINER function was needed, because every
// table this reads already has a `team_lead` RLS policy scoped through
// `team_agent_ids()` (users, audits, agent_status_log/agent_current_status,
// agent_zero_seller_status, agent_weekly_audit_target, pip_candidates,
// review_requests — §2/§6/§9). A Team Lead's scoping is always the ONE
// view, never a My View/Team View toggle (§2, §4 Part B3's own precedent).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { agentVintage, DEFAULT_VINTAGE_SLABS, type Vintage } from '@/lib/agents/vintage'
import { loadVintageSlabs } from '@/lib/agents/vintage.service'
import { dhakaDateStartUtc, dhakaDateEndUtc } from '@/lib/dates/sales-week'

export interface TeamLeadAgentRow {
  agentId: string
  name: string
  teamName: string | null
  siteName: string | null
  vintage: Vintage
  rygStatus: 'red' | 'yellow' | 'green' | 'unrated' | null
  avgAuditScore: number | null
}

export interface FatalIncidentRow {
  auditId: string
  agentId: string
  agentName: string
  auditorName: string | null
  submittedAt: string
  /** The fatal item(s) ticked on this audit (fatal_parameters.description) — may be more than one. */
  fatalParameters: string[]
  /** How many critical-fatal audits this agent has ever had (all time, not just this period). */
  lifetimeFatalCount: number
}

export interface ZeroSellerRow {
  agentId: string
  agentName: string
  vintage: Vintage
  currentStreakWeeks: number
  lastSaleDate: string | null
  /** Whole days from their last sale to now — null only when they have no sale on record at all. */
  daysSinceLastSale: number | null
  /** USD revenue attributed on their last sale date (converted the same way agent_revenue_usd always does). */
  lastSaleRevenueUsd: number | null
}

export interface PipLiveRow {
  /** pip_candidates.id — links straight to /pip/{candidateId} (feedback + training), 2026-10-12. */
  candidateId: string
  agentId: string
  agentName: string
  targetUsd: number | null
  achievedUsd: number
  /** target - achieved, floored at 0; null when no target was ever set for this candidate. */
  remainingUsd: number | null
  daysLeft: number
  runRateRequiredUsdPerDay: number | null
  targetMet: boolean | null
  lastSaleDate: string | null
}

export interface OpenReviewRequestRow {
  requestId: string
  agentId: string
  agentName: string
  status: 'with_team_lead' | 'with_qa_manager'
  daysOpen: number
}

export interface RecentAuditRow {
  auditId: string
  agentId: string
  agentName: string
  scorePercent: number
  criticalFail: boolean
  submittedAt: string
}

export interface TeamLeadDashboard {
  teamLeadName: string
  agentCount: number
  auditsDone: number
  auditTarget: number
  auditPct: number | null
  avgScore: number | null
  passRate: number | null
  agents: TeamLeadAgentRow[]
  fatalIncidents: FatalIncidentRow[]
  zeroSellers: ZeroSellerRow[]
  pipLive: PipLiveRow[]
  openReviewRequests: OpenReviewRequestRow[]
  recentAudits: RecentAuditRow[]
}

export async function loadTeamLeadDashboard(teamLeadId: string, teamLeadName: string, from: Date, to: Date): Promise<TeamLeadDashboard> {
  const supabase = await getSupabaseServer()

  const { data: roster, error: rosterError } = await supabase
    .from('users')
    .select('id, name, team_name, site_name, employment_stage, joining_date, is_active')
    .eq('team_leader_id', teamLeadId)
    .eq('role', 'agent')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (rosterError) throw new Error(`Could not load your team: ${rosterError.message}`)

  const agentIds = (roster ?? []).map((a) => a.id)
  if (agentIds.length === 0) {
    return {
      teamLeadName, agentCount: 0, auditsDone: 0, auditTarget: 0, auditPct: null, avgScore: null, passRate: null,
      agents: [], fatalIncidents: [], zeroSellers: [], pipLive: [], openReviewRequests: [], recentAudits: [],
    }
  }

  const [slabs, auditsRes, targetsRes, statusRes, zeroSellerRes, fatalsRes, reviewRes, recentRes, cycleRes] = await Promise.all([
    loadVintageSlabs().catch(() => DEFAULT_VINTAGE_SLABS),
    // check_mode = 'audit' — a Sample Check has no score and must not inflate "audits done" or
    // (worse) drag down avgScore/passRate by counting toward the denominator with a null score.
    supabase.from('audits').select('score_percent, passed').eq('status', 'submitted').eq('check_mode', 'audit').in('agent_id', agentIds)
      .gte('submitted_at', from.toISOString()).lt('submitted_at', to.toISOString()),
    supabase.from('agent_weekly_audit_target').select('final_target').in('agent_id', agentIds)
      .gte('week_start', from.toISOString().slice(0, 10)).lt('week_start', to.toISOString().slice(0, 10)),
    supabase.from('agent_current_status').select('agent_id, status, avg_audit_score').in('agent_id', agentIds),
    supabase.from('agent_zero_seller_status').select('agent_id, current_streak_weeks, last_sale_date').in('agent_id', agentIds).gt('current_streak_weeks', 0),
    supabase.from('audits').select('id, agent_id, auditor_id, submitted_at').eq('status', 'submitted').eq('critical_fail', true).in('agent_id', agentIds)
      .gte('submitted_at', from.toISOString()).lt('submitted_at', to.toISOString()),
    supabase.from('review_requests').select('id, agent_id, status, created_at').in('agent_id', agentIds).neq('status', 'resolved'),
    // Same check_mode exclusion — "recent audits" means real audits, not Sample Checks.
    supabase.from('audits').select('id, agent_id, score_percent, critical_fail, submitted_at, auditor_id').eq('status', 'submitted').eq('check_mode', 'audit').in('agent_id', agentIds)
      .order('submitted_at', { ascending: false }).limit(15),
    supabase.from('pip_cycles').select('id, start_date, end_date')
      .lte('start_date', new Date().toISOString().slice(0, 10)).gte('end_date', new Date().toISOString().slice(0, 10)).maybeSingle(),
  ])
  if (auditsRes.error) throw new Error(`Could not load audits: ${auditsRes.error.message}`)
  if (targetsRes.error) throw new Error(`Could not load audit targets: ${targetsRes.error.message}`)
  if (statusRes.error) throw new Error(`Could not load RYG status: ${statusRes.error.message}`)
  if (zeroSellerRes.error) throw new Error(`Could not load zero-seller status: ${zeroSellerRes.error.message}`)
  if (fatalsRes.error) throw new Error(`Could not load fatal incidents: ${fatalsRes.error.message}`)
  if (reviewRes.error) throw new Error(`Could not load Review Requests: ${reviewRes.error.message}`)
  if (recentRes.error) throw new Error(`Could not load recent audits: ${recentRes.error.message}`)

  const auditRows = auditsRes.data ?? []
  const auditsDone = auditRows.length
  const scoreSum = auditRows.reduce((s, a) => s + (a.score_percent ?? 0), 0)
  const passed = auditRows.filter((a) => a.passed).length
  const auditTarget = (targetsRes.data ?? []).reduce((s, t) => s + t.final_target, 0)

  // Auditor names for fatal incidents / recent audits (Team Leads may read QA staff names, §2).
  const auditorIds = [...new Set([...(fatalsRes.data ?? []), ...(recentRes.data ?? [])].map((a) => a.auditor_id).filter(Boolean))] as string[]
  const auditorNames = new Map<string, string>()
  if (auditorIds.length > 0) {
    const { data } = await supabase.from('users').select('id, name').in('id', auditorIds)
    for (const u of data ?? []) auditorNames.set(u.id, u.name)
  }

  const statusByAgent = new Map((statusRes.data ?? []).map((s) => [s.agent_id, s]))
  const rosterById = new Map((roster ?? []).map((a) => [a.id, a]))
  // Vintage for every roster agent, not just the filtered "agents" list below (Zero-Seller can
  // include an agent that list excludes, e.g. a discontinued one with an old streak still on record).
  const vintageByAgent = new Map(
    (roster ?? []).map((a) => [a.id, agentVintage({ employment_stage: a.employment_stage, joining_date: a.joining_date }, slabs)])
  )

  const agents: TeamLeadAgentRow[] = (roster ?? [])
    .filter((a) => a.employment_stage === 'active' || a.employment_stage === 'ojt' || a.employment_stage === 're_training')
    .map((a) => {
      const status = statusByAgent.get(a.id)
      return {
        agentId: a.id, name: a.name, teamName: a.team_name, siteName: a.site_name,
        vintage: agentVintage({ employment_stage: a.employment_stage, joining_date: a.joining_date }, slabs),
        rygStatus: (status?.status as 'red' | 'yellow' | 'green' | 'unrated' | undefined) ?? null,
        avgAuditScore: status?.avg_audit_score ?? null,
      }
    })

  // Which fatal item(s) were ticked on each incident, and each agent's lifetime fatal count — both
  // asked for by Jamil (2026-10-11) so a Team Lead can see more than just "a critical fatal happened".
  type OneOrMany<T> = T | T[] | null
  const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const fatalAuditIds = (fatalsRes.data ?? []).map((f) => f.id)
  const fatalAgentIds = [...new Set((fatalsRes.data ?? []).map((f) => f.agent_id))]
  const [fatalParamsRes, lifetimeFatalsRes] = await Promise.all([
    fatalAuditIds.length > 0
      ? supabase.from('audit_fatal_results').select('audit_id, fatal_parameters(description)').in('audit_id', fatalAuditIds)
      : Promise.resolve({ data: [] as { audit_id: string; fatal_parameters: OneOrMany<{ description: string }> }[], error: null }),
    // Lifetime = every submitted, real (non-Sample-Check) critical-fatal audit this agent has ever
    // had, not scoped to the period picker — a running total, same spirit as the repeat-mistake tracker.
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

  const fatalIncidents: FatalIncidentRow[] = (fatalsRes.data ?? []).map((f) => ({
    auditId: f.id, agentId: f.agent_id, agentName: rosterById.get(f.agent_id)?.name ?? 'Unknown', auditorName: f.auditor_id ? auditorNames.get(f.auditor_id) ?? null : null, submittedAt: f.submitted_at,
    fatalParameters: fatalParamsByAudit.get(f.id) ?? [],
    lifetimeFatalCount: lifetimeFatalByAgent.get(f.agent_id) ?? 0,
  }))

  // Last sale date is a Dhaka calendar date, not a known transaction — sum whatever was attributed
  // on that day (agent_revenue_usd, the same converter the rest of the system trusts) rather than
  // trying to pick out a single row, since more than one sale on the same day is routine.
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
  const zeroSellers: ZeroSellerRow[] = (zeroSellerRes.data ?? [])
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

  const openReviewRequests: OpenReviewRequestRow[] = (reviewRes.data ?? [])
    .map((r) => ({
      requestId: r.id, agentId: r.agent_id, agentName: rosterById.get(r.agent_id)?.name ?? 'Unknown', status: r.status as 'with_team_lead' | 'with_qa_manager',
      daysOpen: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.daysOpen - a.daysOpen)

  const recentAudits: RecentAuditRow[] = (recentRes.data ?? []).map((a) => ({
    auditId: a.id, agentId: a.agent_id, agentName: rosterById.get(a.agent_id)?.name ?? 'Unknown', scorePercent: a.score_percent, criticalFail: a.critical_fail, submittedAt: a.submitted_at,
  }))

  // PIP: only the cycle covering today, only this team's approved candidates.
  let pipLive: PipLiveRow[] = []
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

    // Last sale date for whoever is on the PIP right now — not scoped to current zero-sellers
    // (zeroSellerRes only covers an active streak), a PIP candidate may well have sold recently.
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

  return {
    teamLeadName,
    agentCount: agents.length,
    auditsDone,
    auditTarget,
    auditPct: auditTarget > 0 ? Math.round((auditsDone / auditTarget) * 1000) / 10 : null,
    avgScore: auditsDone > 0 ? Math.round((scoreSum / auditsDone) * 100) / 100 : null,
    passRate: auditsDone > 0 ? Math.round((passed / auditsDone) * 1000) / 10 : null,
    agents,
    fatalIncidents,
    zeroSellers,
    pipLive,
    openReviewRequests,
    recentAudits,
  }
}
