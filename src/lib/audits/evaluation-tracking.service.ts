// ============================================================
// SHIKHO QA SYSTEM — evaluation-email click-through report (schema_092,
// 2026-10-12; auditor name + ids schema_101/102, 2026-10-28). Server-only.
// evaluation_tracking_report() is a SECURITY DEFINER function that does its
// own role/scope check — same shape as qa_rubric_fail_trends()/repeat_mistake_report().
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingEvaluationTrackingSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /evaluation_tracking_report|audit_result_views/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface EvaluationTrackingRow {
  auditId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  teamLeaderId: string | null
  teamLeaderName: string | null
  auditorId: string | null
  auditorName: string | null
  submittedAt: string
  viewedAt: string | null
  viewCount: number
}

const PAGE_SIZE = 1000

/** The whole scoped report, unfiltered — the caller filters/aggregates in memory. Paged: a 30-day
 *  window alone has already passed 1,000 rows in production, and a single unranged .rpc() call
 *  silently truncates at PostgREST's own default page size rather than erroring — the exact class
 *  of bug §14 warns about (listUsers(), rematch-revenue.mjs, repeat_mistake_report() all hit it
 *  once each). Confirmed live before this fix: "Last 30 days" showed exactly 1000 "emails sent"
 *  against a real count of 1,903. */
export async function loadEvaluationTrackingReport(
  from: Date, to: Date, view: QaRankingView = 'team'
): Promise<EvaluationTrackingRow[]> {
  const supabase = await getSupabaseServer()
  const rows: EvaluationTrackingRow[] = []
  for (let page = 0; ; page += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('evaluation_tracking_report', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
      .range(page, page + PAGE_SIZE - 1)
    if (error) throw new Error(`Could not load the evaluation tracking report: ${error.message}`)
    const batch = (data ?? []).map((r: {
      audit_id: string; agent_id: string; agent_name: string; team_name: string | null; site_name: string | null
      team_leader_id: string | null; team_leader_name: string | null; auditor_id: string | null; auditor_name: string | null
      submitted_at: string; viewed_at: string | null; view_count: number
    }) => ({
      auditId: r.audit_id, agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
      teamLeaderId: r.team_leader_id, teamLeaderName: r.team_leader_name,
      auditorId: r.auditor_id, auditorName: r.auditor_name,
      submittedAt: r.submitted_at, viewedAt: r.viewed_at, viewCount: r.view_count,
    }))
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return rows
}

/** How many days old, floored — used to decide "stale" styling and the Team Lead attention count. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

/** The grouping key (and filter value) for rows with no QA Auditor / Team Lead id — kept visible
 *  as its own "Unassigned" row rather than silently dropped, same shape used for its filter link. */
export const UNASSIGNED_ID = '__none__'

export interface EvaluationTrackingSummaryRow {
  id: string
  name: string
  sent: number
  viewed: number
  viewedPct: number
  stale: number
}

/** Groups rows by a person (QA Auditor or Team Lead) and summarizes each one's sent/viewed/stale
 *  counts — pure, no database. Sorted worst-first: most stale (unread 3+ days) on top, since that's
 *  the one number on this page that calls for someone to actually do something about it; viewed %
 *  ascending is the tiebreak. Rows with no id (an unassigned slot, or a Team Lead the agent doesn't
 *  have) are grouped together under that id so they're visible rather than silently dropped. */
export function summarizeEvaluationTracking(
  rows: EvaluationTrackingRow[],
  pick: (r: EvaluationTrackingRow) => { id: string | null; name: string | null },
  staleDays: number,
  now: Date = new Date()
): EvaluationTrackingSummaryRow[] {
  const byId = new Map<string, EvaluationTrackingSummaryRow>()
  for (const r of rows) {
    const { id, name } = pick(r)
    const key = id ?? UNASSIGNED_ID
    const label = name ?? 'Unassigned'
    const existing = byId.get(key) ?? { id: key, name: label, sent: 0, viewed: 0, viewedPct: 0, stale: 0 }
    existing.sent += 1
    if (r.viewedAt) existing.viewed += 1
    else if (daysSince(r.submittedAt, now) >= staleDays) existing.stale += 1
    byId.set(key, existing)
  }
  const out = [...byId.values()].map((s) => ({ ...s, viewedPct: s.sent > 0 ? Math.round((s.viewed / s.sent) * 100) : 0 }))
  return out.sort((a, b) => b.stale - a.stale || a.viewedPct - b.viewedPct || a.name.localeCompare(b.name))
}
