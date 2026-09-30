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
  agentName: string
  auditorName: string | null
  submittedAt: string
}

export interface ZeroSellerRow {
  agentId: string
  agentName: string
  currentStreakWeeks: number
  lastSaleDate: string | null
}

export interface PipLiveRow {
  agentId: string
  agentName: string
  targetUsd: number | null
  achievedUsd: number
  daysLeft: number
  runRateRequiredUsdPerDay: number | null
  targetMet: boolean | null
}

export interface OpenReviewRequestRow {
  requestId: string
  agentName: string
  status: 'with_team_lead' | 'with_qa_manager'
  daysOpen: number
}

export interface RecentAuditRow {
  auditId: string
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
    supabase.from('audits').select('score_percent, passed').eq('status', 'submitted').in('agent_id', agentIds)
      .gte('submitted_at', from.toISOString()).lt('submitted_at', to.toISOString()),
    supabase.from('agent_weekly_audit_target').select('final_target').in('agent_id', agentIds)
      .gte('week_start', from.toISOString().slice(0, 10)).lt('week_start', to.toISOString().slice(0, 10)),
    supabase.from('agent_current_status').select('agent_id, status, avg_audit_score').in('agent_id', agentIds),
    supabase.from('agent_zero_seller_status').select('agent_id, current_streak_weeks, last_sale_date').in('agent_id', agentIds).gt('current_streak_weeks', 0),
    supabase.from('audits').select('id, agent_id, auditor_id, submitted_at').eq('status', 'submitted').eq('critical_fail', true).in('agent_id', agentIds)
      .gte('submitted_at', from.toISOString()).lt('submitted_at', to.toISOString()),
    supabase.from('review_requests').select('id, agent_id, status, created_at').in('agent_id', agentIds).neq('status', 'resolved'),
    supabase.from('audits').select('id, agent_id, score_percent, critical_fail, submitted_at, auditor_id').eq('status', 'submitted').in('agent_id', agentIds)
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

  const fatalIncidents: FatalIncidentRow[] = (fatalsRes.data ?? []).map((f) => ({
    auditId: f.id, agentName: rosterById.get(f.agent_id)?.name ?? 'Unknown', auditorName: f.auditor_id ? auditorNames.get(f.auditor_id) ?? null : null, submittedAt: f.submitted_at,
  }))

  const zeroSellers: ZeroSellerRow[] = (zeroSellerRes.data ?? [])
    .map((z) => ({ agentId: z.agent_id, agentName: rosterById.get(z.agent_id)?.name ?? 'Unknown', currentStreakWeeks: z.current_streak_weeks, lastSaleDate: z.last_sale_date }))
    .sort((a, b) => b.currentStreakWeeks - a.currentStreakWeeks)

  const openReviewRequests: OpenReviewRequestRow[] = (reviewRes.data ?? [])
    .map((r) => ({
      requestId: r.id, agentName: rosterById.get(r.agent_id)?.name ?? 'Unknown', status: r.status as 'with_team_lead' | 'with_qa_manager',
      daysOpen: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.daysOpen - a.daysOpen)

  const recentAudits: RecentAuditRow[] = (recentRes.data ?? []).map((a) => ({
    auditId: a.id, agentName: rosterById.get(a.agent_id)?.name ?? 'Unknown', scorePercent: a.score_percent, criticalFail: a.critical_fail, submittedAt: a.submitted_at,
  }))

  // PIP: only the cycle covering today, only this team's approved candidates.
  let pipLive: PipLiveRow[] = []
  const cycle = cycleRes.data as { id: string; start_date: string; end_date: string } | null
  if (cycle) {
    const { data: candidates, error: candErr } = await supabase
      .from('pip_candidates').select('agent_id, target_revenue')
      .eq('pip_cycle_id', cycle.id).eq('status', 'approved').in('agent_id', agentIds)
    if (candErr) throw new Error(`Could not load PIP progress: ${candErr.message}`)
    const cycleStart = dhakaDateStartUtc(cycle.start_date)
    const cycleEndExclusive = dhakaDateEndUtc(cycle.end_date)
    const cappedEnd = new Date(Math.min(Date.now(), cycleEndExclusive.getTime()))
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' }))
    const endDate = new Date(cycle.end_date + 'T00:00:00')
    const daysLeft = Math.max(0, Math.round((endDate.getTime() - today.getTime()) / 86_400_000))
    pipLive = await Promise.all(
      (candidates ?? []).map(async (c) => {
        const { data: rev } = await supabase.rpc('agent_revenue_usd', { p_agent_id: c.agent_id, p_from: cycleStart.toISOString(), p_to: cappedEnd.toISOString() })
        const achieved = Number(rev ?? 0)
        const target = c.target_revenue
        const targetMet = target === null ? null : achieved >= target
        return {
          agentId: c.agent_id, agentName: rosterById.get(c.agent_id)?.name ?? 'Unknown', targetUsd: target, achievedUsd: achieved, daysLeft,
          runRateRequiredUsdPerDay: target !== null && !targetMet ? Math.round(((target - achieved) / Math.max(daysLeft, 1)) * 100) / 100 : null,
          targetMet,
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
