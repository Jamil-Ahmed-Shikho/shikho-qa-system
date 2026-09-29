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
import { dhakaDateEndUtc, dhakaDateStartUtc } from '@/lib/dates/sales-week'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export type PipStatus = 'suggested' | 'excluded' | 'approved' | 'completed' | 'failed'
export type PipUnit = 'BDT' | 'USD'

export interface PipPolicy {
  id: string
  revenueBenchmark: number
  /** Completed SALES WEEKS of tenure (not calendar days), checked at cycle start — schema_040, Q8. */
  vintageMinWeeks: number
  durationWeeks: number
  targetRevenue: number
  bottomNPerSite: number
  /** Which teams/channels PIP applies to — admin-configurable (Q15), same shape as Campaigns' team scope. */
  scopedTeams: string[]
  effectiveFrom: string
}

export interface PipCycle {
  id: string
  month: string
  startDate: string
  endDate: string
  policyId: string
  candidateCount: number
  /** Set once QA Manager/Super Admin publishes the final list (schema_043) — before that, the list is still under review. */
  publishedAt: string | null
  publishedByName: string | null
  /** Set once notifications have gone out for real (Stage 7, schema_047) — a test-mode send never sets this. */
  notificationsSentAt: string | null
}

export type PipRequestType = 'exclude' | 'include'
export type PipRequestStatus = 'pending' | 'accepted' | 'rejected'

export interface PipManagerRequest {
  id: string
  cycleId: string
  agentId: string
  agentName: string
  requestType: PipRequestType
  reason: string
  requestedByName: string | null
  status: PipRequestStatus
  decisionNote: string | null
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
}

/** One row from pip_manager_review()/pip_manager_chain_not_listed() — a Manager's own pre-publish view. */
export interface PipReviewRow {
  candidateId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  status: 'suggested' | 'excluded'
  revenue: number | null
  revenueUnit: PipUnit | null
  vintageWeeks: number | null
  exclusionReason: string | null
  /** 'exclude' | 'include' | null — a request the CALLING manager themself already has pending for this agent. */
  myPendingRequestType: PipRequestType | null
}

export interface PipNotListedAgent {
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
}

export interface PipCandidate {
  id: string
  cycleId: string
  agentId: string
  agentName: string
  agentEmail: string | null
  /** The agent's CURRENT team (from the users row — may differ from teamNameAtSelection if they've since moved). */
  teamName: string | null
  /** Team/site AS RECORDED AT SELECTION (schema_040) — this is the grouping key generate_pip_candidates() actually used. */
  teamNameAtSelection: string | null
  siteName: string | null
  status: PipStatus
  revenue: number | null
  revenueUnit: PipUnit | null
  windowStart: string | null
  windowEnd: string | null
  /** Completed sales weeks of tenure at selection (Q8) — not calendar days. */
  vintageWeeks: number | null
  exclusionReason: string | null
  decisionNote: string | null
  incentiveDowngraded: boolean
  /** The pip_policies.target_revenue in force when this candidate was added (Stage 6) — frozen, like revenueUnit/vintageWeeks. */
  targetRevenue: number | null
  /** How many PIPs in a row, ending with this one, followed an immediately-preceding FAILED PIP (Stage 5) — null until approved. */
  consecutivePipCount: number | null
  /** Total times this agent has ever been put on a PIP (Stage 5) — never resets, null until approved. */
  lifetimePipCount: number | null
  cycleStart: string | null
  cycleEnd: string | null
}

/** A termination-review flag (Stage 5, schema_045) — raised automatically on a 2nd+ CONSECUTIVE failed PIP. */
export interface PipTerminationFlag {
  id: string
  candidateId: string
  agentId: string
  consecutiveCountAtFlag: number
  flaggedAt: string
  exceptionType: 'dismissed' | 'another_chance' | null
  exceptionReason: string | null
  exceptionByName: string | null
  exceptionAt: string | null
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
    vintageMinWeeks: r.vintage_min_weeks as number,
    durationWeeks: r.duration_weeks as number,
    targetRevenue: Number(r.target_revenue),
    bottomNPerSite: r.bottom_n_per_site as number,
    scopedTeams: (r.scoped_teams as string[] | null) ?? [],
    effectiveFrom: r.effective_from as string,
  }
}

const CANDIDATE_SELECT =
  'id, pip_cycle_id, agent_id, team_name, site_name, status, revenue_at_selection, revenue_unit_used, revenue_window_start, revenue_window_end, ' +
  'vintage_weeks_at_selection, exclusion_reason, decision_note, incentive_downgraded, target_revenue, consecutive_pip_count, lifetime_pip_count, ' +
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
    teamNameAtSelection: (r.team_name as string | null) ?? null,
    siteName: (r.site_name as string | null) ?? null,
    status: r.status as PipStatus,
    revenue: r.revenue_at_selection === null ? null : Number(r.revenue_at_selection),
    revenueUnit: (r.revenue_unit_used as PipUnit | null) ?? null,
    windowStart: (r.revenue_window_start as string | null) ?? null,
    windowEnd: (r.revenue_window_end as string | null) ?? null,
    vintageWeeks: (r.vintage_weeks_at_selection as number | null) ?? null,
    exclusionReason: (r.exclusion_reason as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    incentiveDowngraded: !!r.incentive_downgraded,
    targetRevenue: r.target_revenue === null || r.target_revenue === undefined ? null : Number(r.target_revenue),
    consecutivePipCount: (r.consecutive_pip_count as number | null) ?? null,
    lifetimePipCount: (r.lifetime_pip_count as number | null) ?? null,
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

function cycleFromRow(r: Row, candidateCount: number): PipCycle {
  const pub = r.publisher as { name: string } | { name: string }[] | null
  return {
    id: r.id as string,
    month: r.month as string,
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    policyId: r.policy_id as string,
    candidateCount,
    publishedAt: (r.published_at as string | null) ?? null,
    publishedByName: (Array.isArray(pub) ? pub[0]?.name : pub?.name) ?? null,
    notificationsSentAt: (r.notifications_sent_at as string | null) ?? null,
  }
}

const CYCLE_SELECT = 'id, month, start_date, end_date, policy_id, published_at, notifications_sent_at, publisher:users!pip_cycles_published_by_fkey(name)'

export async function loadCycles(): Promise<PipCycle[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_cycles')
    .select(`${CYCLE_SELECT}, pip_candidates(count)`)
    .order('month', { ascending: false })
    .limit(60)
  if (error) throw new Error(`Could not load PIP cycles: ${error.message}`)
  return (data ?? []).map((r) => cycleFromRow(r as Row, Number(((r.pip_candidates as unknown as { count: number }[])?.[0]?.count) ?? 0)))
}

export async function loadCycleWithCandidates(cycleId: string): Promise<{ cycle: PipCycle; policy: PipPolicy | null; candidates: PipCandidate[] } | null> {
  const supabase = await getSupabaseServer()
  const { data: c, error } = await supabase.from('pip_cycles').select(CYCLE_SELECT).eq('id', cycleId).maybeSingle()
  if (error) throw new Error(`Could not load the PIP cycle: ${error.message}`)
  if (!c) return null
  const [{ data: rows, error: cErr }, { data: pol, error: pErr }] = await Promise.all([
    supabase.from('pip_candidates').select(CANDIDATE_SELECT).eq('pip_cycle_id', cycleId),
    supabase.from('pip_policies').select('*').eq('id', (c as Row).policy_id).maybeSingle(),
  ])
  if (cErr) throw new Error(`Could not load candidates: ${cErr.message}`)
  if (pErr) throw new Error(`Could not load the cycle's policy: ${pErr.message}`)
  const candidates = ((rows ?? []) as unknown as Record<string, unknown>[]).map(candidateFromRow)
  // Site, then lowest revenue first — the order the suggestion was made in.
  candidates.sort((a, b) => (a.siteName ?? '~').localeCompare(b.siteName ?? '~') || (a.revenue ?? 0) - (b.revenue ?? 0) || a.agentName.localeCompare(b.agentName))
  return {
    cycle: cycleFromRow(c as Row, candidates.length),
    policy: pol ? policyFromRow(pol) : null,
    candidates,
  }
}

/** Pending Manager requests for one cycle (QA's side of the review — accept/reject). */
export async function loadManagerRequests(cycleId: string): Promise<PipManagerRequest[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_manager_requests')
    .select('id, pip_cycle_id, agent_id, request_type, reason, status, decision_note, decided_at, created_at, ' +
      'agent:users!pip_manager_requests_agent_id_fkey(name), requester:users!pip_manager_requests_requested_by_fkey(name), decider:users!pip_manager_requests_decided_by_fkey(name)')
    .eq('pip_cycle_id', cycleId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Could not load Manager requests: ${error.message}`)
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, cycleId: r.pip_cycle_id, agentId: r.agent_id,
    agentName: one<{ name: string }>(r.agent)?.name ?? 'Unknown agent',
    requestType: r.request_type, reason: r.reason,
    requestedByName: one<{ name: string }>(r.requester)?.name ?? null,
    status: r.status, decisionNote: r.decision_note,
    decidedByName: one<{ name: string }>(r.decider)?.name ?? null,
    decidedAt: r.decided_at, createdAt: r.created_at,
  }))
}

/** A Manager's own pre-publish view of one cycle (schema_043) — their own chain only, suggested/excluded. */
export async function loadManagerReview(cycleId: string): Promise<PipReviewRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_manager_review', { p_cycle_id: cycleId })
  if (error) throw new Error(`Could not load this PIP cycle's suggestions: ${error.message}`)
  return ((data ?? []) as Row[]).map((r) => ({
    candidateId: r.candidate_id, agentId: r.agent_id, agentName: r.agent_name,
    teamName: r.team_name, siteName: r.site_name, status: r.status,
    revenue: r.revenue_at_selection === null ? null : Number(r.revenue_at_selection),
    revenueUnit: r.revenue_unit_used, vintageWeeks: r.vintage_weeks_at_selection,
    exclusionReason: r.exclusion_reason, myPendingRequestType: r.my_pending_request_type,
  }))
}

/** The Manager's own chain agents NOT currently on this cycle's list — candidates for an Include request. */
export async function loadManagerNotListed(cycleId: string): Promise<PipNotListedAgent[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_manager_chain_not_listed', { p_cycle_id: cycleId })
  if (error) throw new Error(`Could not load your team: ${error.message}`)
  return ((data ?? []) as Row[]).map((r) => ({ agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name }))
}

export interface PipManagerCycleSummary {
  cycleId: string
  month: string
  startDate: string
  endDate: string
  /** How many of THIS Manager's own chain are currently suggested/excluded on this cycle. */
  myCount: number
}

export interface PipManagerCycleInfo {
  month: string
  startDate: string
  endDate: string
  publishedAt: string | null
}

/**
 * Every open (unpublished) cycle, for a Manager's /pip/review landing list — via a SECURITY
 * DEFINER function (pip_manager_open_cycles, schema_043), because pip_cycles has no direct SELECT
 * policy for 'manager' pre-publish (only via an approved-or-later candidate, schema_027) — a plain
 * table read here would silently come back empty for every Manager.
 */
export async function loadCyclesForManagerReview(): Promise<PipManagerCycleSummary[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_manager_open_cycles')
  if (error) throw new Error(`Could not load PIP cycles: ${error.message}`)
  return ((data ?? []) as Row[]).map((r) => ({
    cycleId: r.cycle_id, month: r.month, startDate: r.start_date, endDate: r.end_date, myCount: Number(r.my_count ?? 0),
  }))
}

/** One cycle's month/dates for a Manager's review-detail page header (pip_manager_cycle_info, schema_043). */
export async function loadManagerCycleInfo(cycleId: string): Promise<PipManagerCycleInfo | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_manager_cycle_info', { p_cycle_id: cycleId })
  if (error) throw new Error(`Could not load this PIP cycle: ${error.message}`)
  const r = ((data ?? []) as Row[])[0]
  if (!r) return null
  return { month: r.month, startDate: r.start_date, endDate: r.end_date, publishedAt: r.published_at ?? null }
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

/**
 * Stage 6: the agent's own CURRENT PIP, if any — null if they aren't on one (nothing is shown, not
 * an error). RLS (pip_candidates_select_self, unchanged since schema_027) already scopes this to the
 * caller's own approved-or-later rows; `.eq('status','approved')` narrows to "on it right now"
 * specifically, matching "once published, the agent sees they're ON a PIP" (present tense).
 * Achievement is computed on read via agent_revenue_usd() (schema_029, SECURITY INVOKER — runs with
 * the agent's own rights, so it only ever sees their own revenue rows) over the cycle's own window,
 * capped at "now" while the PIP is still running. A failed read of EITHER part throws (§14 — a
 * silently empty portal is worse than an error).
 */
export async function loadMyPip(): Promise<{ candidate: PipCandidate; achievementUsd: number | null } | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_candidates')
    .select(CANDIDATE_SELECT)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not check your PIP status: ${error.message}`)
  if (!data) return null
  const candidate = candidateFromRow(data as unknown as Record<string, unknown>)
  let achievementUsd: number | null = null
  if (candidate.cycleStart) {
    const from = dhakaDateStartUtc(candidate.cycleStart)
    const to = new Date(Math.min(Date.now(), (candidate.cycleEnd ? dhakaDateEndUtc(candidate.cycleEnd) : new Date()).getTime()))
    const { data: usd, error: usdErr } = await supabase.rpc('agent_revenue_usd', {
      p_agent_id: candidate.agentId, p_from: from.toISOString(), p_to: to.toISOString(),
    })
    // A failed achievement read still shows the period/target/downgrade note — it just says
    // "could not be loaded" for the one figure that failed, same principle as the audit page's
    // revenue/lead cards (§4) — never a silent zero.
    if (!usdErr) achievementUsd = Number(usd)
  }
  return { candidate, achievementUsd }
}

export async function loadCandidate(candidateId: string): Promise<{
  candidate: PipCandidate
  feedback: PipFeedback[]
  trainings: PipTraining[]
  /** A termination-review flag on THIS candidate (Stage 5) — only ever set on a failed one, and only
   * ever visible here to QA staff / the agent's own Manager (RLS); null for anyone else, including a
   * Team Lead or the agent, same as an empty result — never distinguishable from "not flagged". */
  terminationFlag: PipTerminationFlag | null
} | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('pip_candidates').select(CANDIDATE_SELECT).eq('id', candidateId).maybeSingle()
  if (error) throw new Error(`Could not load the PIP: ${error.message}`)
  if (!data) return null
  const [fb, tr, flag] = await Promise.all([
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
    supabase
      .from('pip_termination_flags')
      .select('id, pip_candidate_id, agent_id, consecutive_count_at_flag, flagged_at, exception_type, exception_reason, exception_at, ' +
        'decider:users!pip_termination_flags_exception_by_fkey(name)')
      .eq('pip_candidate_id', candidateId)
      .maybeSingle(),
  ])
  if (fb.error) throw new Error(`Could not load feedback: ${fb.error.message}`)
  if (tr.error) throw new Error(`Could not load training sessions: ${tr.error.message}`)
  if (flag.error) throw new Error(`Could not check for a termination-review flag: ${flag.error.message}`)
  const flagRow = flag.data as Record<string, unknown> | null
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
    terminationFlag: flagRow ? {
      id: flagRow.id as string,
      candidateId: flagRow.pip_candidate_id as string,
      agentId: flagRow.agent_id as string,
      consecutiveCountAtFlag: flagRow.consecutive_count_at_flag as number,
      flaggedAt: flagRow.flagged_at as string,
      exceptionType: (flagRow.exception_type as PipTerminationFlag['exceptionType']) ?? null,
      exceptionReason: (flagRow.exception_reason as string | null) ?? null,
      exceptionByName: (flagRow.decider as { name: string } | null)?.name ?? null,
      exceptionAt: (flagRow.exception_at as string | null) ?? null,
    } : null,
  }
}
