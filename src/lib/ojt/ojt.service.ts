// ============================================================
// SHIKHO QA SYSTEM — OJT & Re-Training lifecycle (§7, Step 8)
// Server-only. Reads use the signed-in user's session, so RLS/`ojt_candidates()`
// (schema_038) decide what each role sees: QA all, Team Lead own team, Manager
// own chain — nobody else. NOTHING HERE SENDS EMAIL.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

export type OjtStage = 'ojt' | 're_training'
export type OjtTransitionTarget = 'active' | 're_training' | 'not_certified' | 'discontinued'

export interface OjtCandidate {
  agentId: string
  name: string
  email: string
  teamName: string | null
  siteName: string | null
  teamLeaderId: string | null
  teamLeaderName: string | null
  trainerName: string | null
  stage: OjtStage
  ojtStartDate: string | null
  daysInStage: number | null
  reTrainingStartDate: string | null
  reTrainingEndDate: string | null
  reTrainingDaysLeft: number | null
  ojtCallsThisWeek: number
  ojtTarget: number | null
  reTrainingCallDone: boolean | null
  lastAuditedAt: string | null
  lastCoachedAt: string | null
  lastWeekUsd: number | null
  thisWeekUsd: number | null
  lastWeekComputed: boolean
  lastWeekAvgScore: number | null
  thisWeekAvgScore: number | null
}

export interface OjtHistoryRow {
  id: string
  agentId: string
  agentName: string
  fromStage: OjtStage
  toStage: OjtTransitionTarget
  reTrainingStartDate: string | null
  reTrainingEndDate: string | null
  note: string | null
  changedByName: string | null
  changedAt: string
}

/** True when a failed read looks like "schema_038 isn't applied yet". */
export function isMissingOjtSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /(ojt_status_history|ojt_candidates|ojt_transition)/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Everyone currently in OJT or re-training, within the viewer's scope.
 * view: 'mine' restricts a QA Auditor to their own assigned agents (quality_auditor_id);
 * ignored for every other role, same convention as qa_agent_queue() (schema_067). Throws on a failed read. */
export async function loadOjtCandidates(view: 'mine' | 'team' = 'team'): Promise<OjtCandidate[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('ojt_candidates', { p_view: view })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    agentId: r.agent_id,
    name: r.name,
    email: r.email,
    teamName: r.team_name,
    siteName: r.site_name,
    teamLeaderId: r.team_leader_id,
    teamLeaderName: r.team_leader_name,
    trainerName: r.trainer_name,
    stage: r.employment_stage,
    ojtStartDate: r.ojt_start_date,
    daysInStage: num(r.days_in_stage),
    reTrainingStartDate: r.re_training_start_date,
    reTrainingEndDate: r.re_training_end_date,
    reTrainingDaysLeft: num(r.re_training_days_left),
    ojtCallsThisWeek: Number(r.ojt_calls_this_week),
    ojtTarget: num(r.ojt_target),
    reTrainingCallDone: r.re_training_call_done,
    lastAuditedAt: r.last_audited_at,
    lastCoachedAt: r.last_coached_at,
    lastWeekUsd: num(r.last_week_usd),
    thisWeekUsd: num(r.this_week_usd),
    lastWeekComputed: Boolean(r.last_week_computed),
    lastWeekAvgScore: num(r.last_week_avg_score),
    thisWeekAvgScore: num(r.this_week_avg_score),
  }))
}

/** The last N logged transitions, within the viewer's scope. */
export async function loadOjtHistory(limit = 50): Promise<OjtHistoryRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('ojt_status_history_view')
    .select('id, agent_id, agent_name, from_stage, to_stage, re_training_start_date, re_training_end_date, note, changed_by_name, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id, agentId: r.agent_id, agentName: r.agent_name, fromStage: r.from_stage, toStage: r.to_stage,
    reTrainingStartDate: r.re_training_start_date, reTrainingEndDate: r.re_training_end_date, note: r.note,
    changedByName: r.changed_by_name, changedAt: r.changed_at,
  }))
}
