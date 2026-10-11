// ============================================================
// SHIKHO QA SYSTEM — Automatic CAPA repeat-mistake report (§4 Part 2, "Part 2a")
// Server-only. Reads run as the signed-in user; repeat_mistake_report() is a
// SECURITY DEFINER function that does its own role/scope check (schema_049) —
// same shape as campaign_report() (§4 Part B3). The tracking itself is written
// entirely inside write_audit_results(); nothing here ever writes.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { type RepeatMistakeRow, type RepeatMistakeStatus } from './labels'

export { STATUS_LABEL, type RepeatMistakeStatus, type RepeatMistakeRow } from './labels'

/** True when a failed read looks like "schema_049 isn't applied yet". */
export function isMissingRepeatMistakeSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /capa_repeat_mistakes|repeat_mistake_report/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

function fromRow(r: {
  agent_id: string; agent_name: string; team_name: string | null; site_name: string | null; team_leader_name: string | null
  parameter_id: string; parameter_name: string
  fail_count: number; status: string; first_flagged_at: string; last_checked_at: string | null
}): RepeatMistakeRow {
  return {
    agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name, teamLeaderName: r.team_leader_name,
    parameterId: r.parameter_id, parameterName: r.parameter_name,
    failCount: r.fail_count, status: r.status as RepeatMistakeStatus,
    firstFlaggedAt: r.first_flagged_at, lastCheckedAt: r.last_checked_at,
  }
}

const PAGE_SIZE = 1000

/** The whole scoped report, unfiltered — the caller filters in memory. `view` only matters for a
 * qa_auditor viewer (My/Team). Paged: this table has grown well past PostgREST's own default
 * 1000-row response cap (the exact class of bug §14 already warns about — listUsers() and
 * rematch-revenue.mjs both hit it once each), so a single unranged call here would silently
 * truncate real data rather than error. */
export async function loadRepeatMistakeReport(view: QaRankingView = 'team'): Promise<RepeatMistakeRow[]> {
  const supabase = await getSupabaseServer()
  const rows: RepeatMistakeRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('repeat_mistake_report', { p_parameter_id: null, p_view: view })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Could not load the Repeat-Mistake report: ${error.message}`)
    const page = (data ?? []).map(fromRow)
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}
