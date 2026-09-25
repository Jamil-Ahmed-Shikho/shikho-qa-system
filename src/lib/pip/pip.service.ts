// ============================================================
// SHIKHO QA SYSTEM — PIP module service (§6.4)
// Server-only. Reads go through the signed-in user's session, so the
// database's row-level security (schema_027) decides what each role sees:
// QA staff see everything; a Team Lead / Manager / agent only see a PIP once
// it is approved (never a mere suggestion or exclusion).
//
// NOTHING HERE SENDS EMAIL OR ANY NOTIFICATION — deliberately. PIP messages
// to real people need a human review before they exist at all.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export type PipStatus = 'suggested' | 'excluded' | 'approved' | 'completed' | 'failed'
export type PipUnit = 'BDT' | 'USD'

export interface PipPolicy {
  id: string
  revenueBenchmark: number
  vintageMinDays: number
  durationWeeks: number
  targetRevenue: number
  bottomNPerSite: number
  revenueWindowWeeks: number | null
  revenueUnit: PipUnit | null
  effectiveFrom: string
}

export interface PipCycle {
  id: string
  month: string
  startDate: string
  endDate: string
  policyId: string
  candidateCount: number
}

export interface PipCandidate {
  id: string
  cycleId: string
  agentId: string
  agentName: string
  agentEmail: string | null
  teamName: string | null
  siteName: string | null
  status: PipStatus
  revenue: number | null
  revenueUnit: PipUnit | null
  windowStart: string | null
  windowEnd: string | null
  vintageDays: number | null
  exclusionReason: string | null
  decisionNote: string | null
  incentiveDowngraded: boolean
  cycleStart: string | null
  cycleEnd: string | null
}

export interface PipFeedback {
  id: string
  teamLeaderName: string | null
  feedback: string
  createdAt: string
}

export interface PipTraining {
  id: string
  sessionNumber: number
  scheduledAt: string | null
  conductedByName: string | null
  status: 'scheduled' | 'completed' | 'cancelled'
  attended: boolean | null
  notes: string | null
}

function policyFromRow(r: Record<string, unknown>): PipPolicy {
  return {
    id: r.id as string,
    revenueBenchmark: Number(r.revenue_benchmark),
    vintageMinDays: r.vintage_min_days as number,
    durationWeeks: r.duration_weeks as number,
    targetRevenue: Number(r.target_revenue),
    bottomNPerSite: r.bottom_n_per_site as number,
    revenueWindowWeeks: (r.revenue_window_weeks as number | null) ?? null,
    revenueUnit: (r.revenue_unit as PipUnit | null) ?? null,
    effectiveFrom: r.effective_from as string,
  }
}

const CANDIDATE_SELECT =
  'id, pip_cycle_id, agent_id, site_name, status, revenue_at_selection, revenue_unit_used, revenue_window_start, revenue_window_end, ' +
  'vintage_days_at_selection, exclusion_reason, decision_note, incentive_downgraded, ' +
  'agent:users!pip_candidates_agent_id_fkey(name, email, team_name), cycle:pip_cycles(start_date, end_date)'

function candidateFromRow(r: Record<string, unknown>): PipCandidate {
  const agent = r.agent as { name: string; email: string; team_name: string | null } | null
  const cycle = r.cycle as { start_date: string; end_date: string } | null
  return {
    id: r.id as string,
    cycleId: r.pip_cycle_id as string,
    agentId: r.agent_id as string,
    agentName: agent?.name ?? 'Unknown agent',
    agentEmail: agent?.email ?? null,
    teamName: agent?.team_name ?? null,
    siteName: (r.site_name as string | null) ?? null,
    status: r.status as PipStatus,
    revenue: r.revenue_at_selection === null ? null : Number(r.revenue_at_selection),
    revenueUnit: (r.revenue_unit_used as PipUnit | null) ?? null,
    windowStart: (r.revenue_window_start as string | null) ?? null,
    windowEnd: (r.revenue_window_end as string | null) ?? null,
    vintageDays: (r.vintage_days_at_selection as number | null) ?? null,
    exclusionReason: (r.exclusion_reason as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    incentiveDowngraded: !!r.incentive_downgraded,
    cycleStart: cycle?.start_date ?? null,
    cycleEnd: cycle?.end_date ?? null,
  }
}

/** The current policy, or null if none can be read (a failed read throws — never "no policy"). */
export async function loadCurrentPolicy(): Promise<PipPolicy | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('pip_policies').select('*').is('effective_to', null).maybeSingle()
  if (error) throw new Error(`Could not load the PIP policy: ${error.message}`)
  return data ? policyFromRow(data) : null
}

export async function loadCycles(): Promise<PipCycle[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_cycles')
    .select('id, month, start_date, end_date, policy_id, pip_candidates(count)')
    .order('month', { ascending: false })
    .limit(60)
  if (error) throw new Error(`Could not load PIP cycles: ${error.message}`)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    month: r.month as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    policyId: r.policy_id as string,
    candidateCount: Number(((r.pip_candidates as unknown as { count: number }[])?.[0]?.count) ?? 0),
  }))
}

export async function loadCycleWithCandidates(cycleId: string): Promise<{ cycle: PipCycle; policy: PipPolicy | null; candidates: PipCandidate[] } | null> {
  const supabase = await getSupabaseServer()
  const { data: c, error } = await supabase.from('pip_cycles').select('id, month, start_date, end_date, policy_id').eq('id', cycleId).maybeSingle()
  if (error) throw new Error(`Could not load the PIP cycle: ${error.message}`)
  if (!c) return null
  const [{ data: rows, error: cErr }, { data: pol, error: pErr }] = await Promise.all([
    supabase.from('pip_candidates').select(CANDIDATE_SELECT).eq('pip_cycle_id', cycleId),
    supabase.from('pip_policies').select('*').eq('id', c.policy_id).maybeSingle(),
  ])
  if (cErr) throw new Error(`Could not load candidates: ${cErr.message}`)
  if (pErr) throw new Error(`Could not load the cycle's policy: ${pErr.message}`)
  const candidates = ((rows ?? []) as unknown as Record<string, unknown>[]).map(candidateFromRow)
  // Site, then lowest revenue first — the order the suggestion was made in.
  candidates.sort((a, b) => (a.siteName ?? '~').localeCompare(b.siteName ?? '~') || (a.revenue ?? 0) - (b.revenue ?? 0) || a.agentName.localeCompare(b.agentName))
  return {
    cycle: { id: c.id as string, month: c.month as string, startDate: c.start_date as string, endDate: c.end_date as string, policyId: c.policy_id as string, candidateCount: candidates.length },
    policy: pol ? policyFromRow(pol) : null,
    candidates,
  }
}

/** Approved-or-later PIPs in the caller's scope (a Team Lead's team, a Manager's chain, or everyone for QA staff). */
export async function loadVisiblePips(): Promise<PipCandidate[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_candidates')
    .select(CANDIDATE_SELECT)
    .in('status', ['approved', 'completed', 'failed'])
    .limit(500)
  if (error) throw new Error(`Could not load PIPs: ${error.message}`)
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(candidateFromRow)
  // Running first, then most recent cycle.
  const rank: Record<string, number> = { approved: 0, failed: 1, completed: 2 }
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (b.cycleStart ?? '').localeCompare(a.cycleStart ?? '') || a.agentName.localeCompare(b.agentName))
}

export async function loadCandidate(candidateId: string): Promise<{
  candidate: PipCandidate
  feedback: PipFeedback[]
  trainings: PipTraining[]
} | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('pip_candidates').select(CANDIDATE_SELECT).eq('id', candidateId).maybeSingle()
  if (error) throw new Error(`Could not load the PIP: ${error.message}`)
  if (!data) return null
  const [fb, tr] = await Promise.all([
    supabase
      .from('pip_tl_feedback')
      .select('id, feedback, created_at, leader:users!pip_tl_feedback_team_leader_id_fkey(name)')
      .eq('pip_candidate_id', candidateId)
      .order('created_at', { ascending: false }),
    supabase
      .from('pip_trainings')
      .select('id, session_number, scheduled_at, status, attended, notes, conductor:users!pip_trainings_conducted_by_fkey(name)')
      .eq('pip_candidate_id', candidateId)
      .order('session_number'),
  ])
  if (fb.error) throw new Error(`Could not load feedback: ${fb.error.message}`)
  if (tr.error) throw new Error(`Could not load training sessions: ${tr.error.message}`)
  return {
    candidate: candidateFromRow(data as unknown as Record<string, unknown>),
    feedback: ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      feedback: r.feedback as string,
      createdAt: r.created_at as string,
      teamLeaderName: (r.leader as { name: string } | null)?.name ?? null,
    })),
    trainings: ((tr.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      sessionNumber: r.session_number as number,
      scheduledAt: (r.scheduled_at as string | null) ?? null,
      status: r.status as PipTraining['status'],
      attended: (r.attended as boolean | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      conductedByName: (r.conductor as { name: string } | null)?.name ?? null,
    })),
  }
}
