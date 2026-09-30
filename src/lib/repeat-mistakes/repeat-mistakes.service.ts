// ============================================================
// SHIKHO QA SYSTEM — Automatic CAPA repeat-mistake report (§4 Part 2, "Part 2a")
// Server-only. Reads run as the signed-in user; repeat_mistake_report() is a
// SECURITY DEFINER function that does its own role/scope check (schema_049) —
// same shape as campaign_report() (§4 Part B3). The tracking itself is written
// entirely inside write_audit_results(); nothing here ever writes.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export type RepeatMistakeStatus = 'still_failing' | 'improved' | 'not_yet_rechecked'

export const STATUS_LABEL: Record<RepeatMistakeStatus, string> = {
  still_failing: 'Still failing',
  improved: 'Improved',
  not_yet_rechecked: 'Not yet re-checked',
}

export interface RepeatMistakeRow {
  agentId: string
  agentName: string
  parameterId: string
  parameterName: string
  failCount: number
  status: RepeatMistakeStatus
  firstFlaggedAt: string
  lastCheckedAt: string | null
}

/** True when a failed read looks like "schema_049 isn't applied yet". */
export function isMissingRepeatMistakeSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /capa_repeat_mistakes|repeat_mistake_report/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

function fromRow(r: {
  agent_id: string; agent_name: string; parameter_id: string; parameter_name: string
  fail_count: number; status: string; first_flagged_at: string; last_checked_at: string | null
}): RepeatMistakeRow {
  return {
    agentId: r.agent_id, agentName: r.agent_name, parameterId: r.parameter_id, parameterName: r.parameter_name,
    failCount: r.fail_count, status: r.status as RepeatMistakeStatus,
    firstFlaggedAt: r.first_flagged_at, lastCheckedAt: r.last_checked_at,
  }
}

/** The whole scoped report, unfiltered — the caller filters by parameter in memory (small dataset: only actively tracked pairs, not every audit). */
export async function loadRepeatMistakeReport(): Promise<RepeatMistakeRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('repeat_mistake_report', { p_parameter_id: null })
  if (error) throw new Error(`Could not load the Repeat-Mistake report: ${error.message}`)
  return (data ?? []).map(fromRow)
}
