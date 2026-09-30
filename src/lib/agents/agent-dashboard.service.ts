// ============================================================
// SHIKHO QA SYSTEM — Agent's own dashboard (§11)
// Server-only. Every read here runs as the signed-in agent, so RLS already
// limits everything to their own rows — no new SECURITY DEFINER function
// needed anywhere in this file.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { loadAgentRevenue, type AgentRevenue } from '@/lib/audits/audit-context.service'
import { previousSalesWeekStartDate, salesWeekStart, salesWeekStartDate, dhakaDateStartUtc } from '@/lib/dates/sales-week'
import type { ReviewRequestStatus } from '@/lib/review-requests/validation'

export type RygStatus = 'red' | 'yellow' | 'green' | 'unrated'

export interface WeekStats {
  weekStart: string
  audits: number
  avgScore: number | null
  passed: number
  failed: number
}

export interface TrendPoint {
  auditId: string
  submittedAt: string
  scorePercent: number
  criticalFail: boolean
}

export interface FailedParameter {
  parameterId: string
  name: string
  failCount: number
}

export interface CoachingOutcome {
  scheduledAt: string
  auditId: string
  failedParameters: { name: string; feedback: string | null }[]
}

export interface AgentDashboard {
  agentName: string
  ryg: { status: RygStatus; avgAuditScore: number | null; periodEnd: string | null }
  thisWeek: WeekStats
  lastWeek: WeekStats
  mtdAvgScore: number | null
  scoreTrend: TrendPoint[]
  topFailedParameters: FailedParameter[]
  recentCriticalFail: { auditId: string; submittedAt: string } | null
  revenue: AgentRevenue | null
  revenueFailed: boolean
  coaching: CoachingOutcome | null
  openReviewRequest: { auditId: string; status: ReviewRequestStatus } | null
}

function bucket(audits: { submitted_at: string; score_percent: number | null; passed: boolean | null }[], from: Date, to: Date, weekStart: string): WeekStats {
  const rows = audits.filter((a) => {
    const t = new Date(a.submitted_at).getTime()
    return t >= from.getTime() && t < to.getTime()
  })
  const scores = rows.map((r) => r.score_percent).filter((s): s is number => s !== null)
  return {
    weekStart,
    audits: rows.length,
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    passed: rows.filter((r) => r.passed === true).length,
    failed: rows.filter((r) => r.passed === false).length,
  }
}

export async function loadAgentDashboard(agentId: string, agentName: string, now: Date = new Date()): Promise<AgentDashboard> {
  const supabase = await getSupabaseServer()

  const thisWeekStart = salesWeekStart(now)
  const lastWeekStartStr = previousSalesWeekStartDate(now)
  const lastWeekStart = dhakaDateStartUtc(lastWeekStartStr)
  const dhakaNow = new Date(now.getTime() + 6 * 60 * 60 * 1000)
  const monthStr = `${dhakaNow.getUTCFullYear()}-${String(dhakaNow.getUTCMonth() + 1).padStart(2, '0')}-01`
  const monthStart = dhakaDateStartUtc(monthStr)
  const historyFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const [recentAudits, statusRow, briefing, requests, revenue] = await Promise.all([
    supabase
      .from('audits')
      .select('id, score_percent, passed, critical_fail, submitted_at, audit_parameter_results(passed, parameter_id, rubric_parameters(name))')
      .eq('agent_id', agentId)
      .eq('status', 'submitted')
      .gte('submitted_at', historyFrom.toISOString())
      .order('submitted_at', { ascending: false })
      .limit(120),
    supabase.from('agent_current_status').select('status, avg_audit_score, period_end').eq('agent_id', agentId).maybeSingle(),
    supabase.from('briefings').select('id, audit_id, scheduled_at').eq('agent_id', agentId).eq('status', 'completed').order('scheduled_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('review_requests').select('audit_id, status').eq('agent_id', agentId).neq('status', 'resolved').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    loadAgentRevenue(agentId, now).then((r) => ({ ok: true as const, value: r }), () => ({ ok: false as const, value: null })),
  ])
  if (recentAudits.error) throw new Error(`Could not load your audits: ${recentAudits.error.message}`)

  type Row = { id: string; score_percent: number | null; passed: boolean | null; critical_fail: boolean; submitted_at: string; audit_parameter_results: { passed: boolean; parameter_id: string; rubric_parameters: { name: string } | { name: string }[] | null }[] }
  const rows = (recentAudits.data ?? []) as unknown as Row[]

  const thisWeek = bucket(rows, thisWeekStart, new Date(Math.max(now.getTime(), thisWeekStart.getTime())), salesWeekStartDate(now))
  const lastWeek = bucket(rows, lastWeekStart, thisWeekStart, lastWeekStartStr)

  const mtdRows = rows.filter((r) => new Date(r.submitted_at).getTime() >= monthStart.getTime())
  const mtdScores = mtdRows.map((r) => r.score_percent).filter((s): s is number => s !== null)
  const mtdAvgScore = mtdScores.length ? Math.round((mtdScores.reduce((a, b) => a + b, 0) / mtdScores.length) * 10) / 10 : null

  const scoreTrend: TrendPoint[] = rows
    .slice(0, 10)
    .filter((r) => r.score_percent !== null)
    .map((r) => ({ auditId: r.id, submittedAt: r.submitted_at, scorePercent: r.score_percent as number, criticalFail: r.critical_fail }))
    .reverse()

  const failCounts = new Map<string, { name: string; count: number }>()
  for (const r of rows) {
    for (const apr of r.audit_parameter_results ?? []) {
      if (apr.passed) continue
      const nameRaw = apr.rubric_parameters
      const name = (Array.isArray(nameRaw) ? nameRaw[0]?.name : nameRaw?.name) ?? 'Unknown parameter'
      const cur = failCounts.get(apr.parameter_id) ?? { name, count: 0 }
      cur.count++
      failCounts.set(apr.parameter_id, cur)
    }
  }
  const topFailedParameters: FailedParameter[] = [...failCounts.entries()]
    .map(([parameterId, v]) => ({ parameterId, name: v.name, failCount: v.count }))
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 5)

  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
  const criticalRow = rows.find((r) => r.critical_fail && new Date(r.submitted_at).getTime() >= fourWeeksAgo.getTime())
  const recentCriticalFail = criticalRow ? { auditId: criticalRow.id, submittedAt: criticalRow.submitted_at } : null

  const ryg: AgentDashboard['ryg'] = statusRow.data
    ? { status: (statusRow.data.status as RygStatus) ?? 'unrated', avgAuditScore: statusRow.data.avg_audit_score === null ? null : Number(statusRow.data.avg_audit_score), periodEnd: statusRow.data.period_end }
    : { status: 'unrated', avgAuditScore: null, periodEnd: null }

  let coaching: CoachingOutcome | null = null
  if (briefing.data?.audit_id) {
    const { data: failedParams } = await supabase
      .from('audit_parameter_results')
      .select('feedback, rubric_parameters(name)')
      .eq('audit_id', briefing.data.audit_id)
      .eq('passed', false)
    coaching = {
      scheduledAt: briefing.data.scheduled_at,
      auditId: briefing.data.audit_id,
      failedParameters: (failedParams ?? []).map((p) => {
        const nameRaw = p.rubric_parameters as { name: string } | { name: string }[] | null
        return { name: (Array.isArray(nameRaw) ? nameRaw[0]?.name : nameRaw?.name) ?? 'Unknown parameter', feedback: p.feedback as string | null }
      }),
    }
  }

  const openReviewRequest: AgentDashboard['openReviewRequest'] = requests.data
    ? { auditId: requests.data.audit_id as string, status: requests.data.status as ReviewRequestStatus }
    : null

  return {
    agentName,
    ryg,
    thisWeek,
    lastWeek,
    mtdAvgScore,
    scoreTrend,
    topFailedParameters,
    recentCriticalFail,
    revenue: revenue.ok ? revenue.value : null,
    revenueFailed: !revenue.ok,
    coaching,
    openReviewRequest,
  }
}
