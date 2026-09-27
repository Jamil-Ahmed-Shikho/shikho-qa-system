// ============================================================
// SHIKHO QA SYSTEM — Calibration sessions service (§5, Stage 1)
// Server-only. Reads use the signed-in user's session so RLS (schema_031)
// decides what each role sees: QA Manager / Super Admin everything; anyone
// else only sessions they take part in (a Team Lead only ones they were
// invited to). NOTHING HERE SENDS EMAIL.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { CalibrationKind, Candidate, ItemType } from './validation'

export interface CalibrationSession {
  id: string
  kind: CalibrationKind
  title: string | null
  itemType: ItemType
  itemReference: string | null
  crmLeadId: string | null
  crmCallId: string | null
  callStartedAt: string | null
  callStatus: string | null
  rubricId: string
  rubricName: string | null
  teamName: string
  siteName: string
  scheduledAt: string
  status: 'scheduled' | 'closed' | 'cancelled'
  createdBy: string
  schedulerName: string | null
}

export interface CalibrationParticipant {
  userId: string
  name: string
  role: string
  isScheduler: boolean
}

/** True when a failed read looks like "schema_031 isn't applied yet". */
export function isMissingCalibrationSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /calibration_(sessions|participants)|create_calibration_session/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

const SELECT =
  'id, kind, title, item_type, item_reference, crm_lead_id, crm_call_id, call_started_at, call_status, rubric_id, team_name, site_name, scheduled_at, status, created_by, rubrics(name), scheduler:users!calibration_sessions_created_by_fkey(name)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function toSession(r: Row): CalibrationSession {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    itemType: r.item_type,
    itemReference: r.item_reference,
    crmLeadId: r.crm_lead_id,
    crmCallId: r.crm_call_id,
    callStartedAt: r.call_started_at,
    callStatus: r.call_status,
    rubricId: r.rubric_id,
    rubricName: one<{ name: string }>(r.rubrics)?.name ?? null,
    teamName: r.team_name,
    siteName: r.site_name,
    scheduledAt: r.scheduled_at,
    status: r.status,
    createdBy: r.created_by,
    schedulerName: one<{ name: string }>(r.scheduler)?.name ?? null,
  }
}

/** Sessions the viewer can see (RLS-scoped), newest first. Throws on a failed read. */
export async function listSessions(): Promise<CalibrationSession[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('calibration_sessions')
    .select(SELECT)
    .order('scheduled_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toSession)
}

export async function getSession(
  id: string
): Promise<{ session: CalibrationSession; participants: CalibrationParticipant[] } | null> {
  const supabase = await getSupabaseServer()
  const [s, p] = await Promise.all([
    supabase.from('calibration_sessions').select(SELECT).eq('id', id).maybeSingle(),
    supabase
      .from('calibration_participants')
      .select('user_id, role_at_invite, is_scheduler, users(name)')
      .eq('session_id', id),
  ])
  if (s.error) throw new Error(s.error.message)
  if (p.error) throw new Error(p.error.message)
  if (!s.data) return null
  const participants: CalibrationParticipant[] = (p.data ?? []).map((r: Row) => ({
    userId: r.user_id,
    name: one<{ name: string }>(r.users)?.name ?? 'Unknown',
    role: r.role_at_invite,
    isScheduler: r.is_scheduler,
  }))
  participants.sort((a, b) => Number(b.isScheduler) - Number(a.isScheduler) || a.name.localeCompare(b.name))
  return { session: toSession(s.data), participants }
}

/** Everyone who could ever be invited: active QA staff and Team Leads (the form narrows by scope). */
export async function loadCandidates(): Promise<Candidate[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, role, team_name, site_name')
    .in('role', ['qa_auditor', 'qa_manager', 'super_admin', 'team_lead'])
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((u) => ({ id: u.id, name: u.name, role: u.role, teamName: u.team_name, siteName: u.site_name }))
}

export interface RubricOption {
  id: string
  name: string
}

/** Active rubrics, plus each team's newest mapped one (to preselect). */
export async function loadRubricChoices(): Promise<{ rubrics: RubricOption[]; byTeam: Record<string, string> }> {
  const supabase = await getSupabaseServer()
  const [r, m] = await Promise.all([
    supabase.from('rubrics').select('id, name, version, created_at').eq('is_active', true).order('created_at', { ascending: false }),
    supabase.from('team_rubric_mapping').select('team_name, rubric_id'),
  ])
  if (r.error) throw new Error(r.error.message)
  if (m.error) throw new Error(m.error.message)
  const rubrics = (r.data ?? []).map((x) => ({ id: x.id, name: `${x.name} (v${x.version})` }))
  const order = new Map((r.data ?? []).map((x, i) => [x.id, i]))
  const byTeam: Record<string, string> = {}
  for (const row of m.data ?? []) {
    const rank = order.get(row.rubric_id)
    if (rank === undefined) continue // inactive rubric
    const cur = byTeam[row.team_name]
    if (!cur || rank < (order.get(cur) ?? Infinity)) byTeam[row.team_name] = row.rubric_id
  }
  return { rubrics, byTeam }
}

// ── Stage 3: scoring + results ─────────────────────────────

export interface CalibrationRubric {
  id: string
  name: string
  categories: { id: string; name: string; parameters: { id: string; name: string; points: number }[] }[]
  fatals: { id: string; description: string; severity: 'critical' | 'major' }[]
}

export interface CalibrationResultsState {
  isParticipant: boolean
  mySubmitted: boolean
  canScore: boolean
  /** true when the viewer may see everyone's scores (session time passed after they submitted, or closed) */
  revealed: boolean
  submittedCount: number
  participantCount: number
  scores: import('./variance').ParticipantScore[]
}

/** The session's rubric, reduced to what scoring needs. */
export async function loadCalibrationRubric(rubricId: string): Promise<CalibrationRubric | null> {
  const { getRubricTree } = await import('@/lib/rubrics/rubrics.service')
  const tree = await getRubricTree(rubricId)
  if (!tree) return null
  return {
    id: tree.id,
    name: tree.name,
    categories: tree.rubric_categories.map((c) => ({
      id: c.id,
      name: c.name,
      parameters: c.rubric_parameters.map((p) => ({ id: p.id, name: p.name, points: Number(p.points) })),
    })),
    fatals: tree.fatal_parameters.map((f) => ({ id: f.id, description: f.description, severity: f.severity })),
  }
}

/** My scoring state + the scores I'm allowed to see (the database decides — schema_032). Null = not allowed. */
export async function loadResults(sessionId: string): Promise<CalibrationResultsState | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('calibration_results', { p_session_id: sessionId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const d = data as Row
  return {
    isParticipant: d.is_participant,
    mySubmitted: d.my_submitted,
    canScore: d.can_score,
    revealed: d.revealed,
    submittedCount: Number(d.submitted_count),
    participantCount: Number(d.participant_count),
    scores: (d.scores as Row[]).map((s) => ({
      userId: s.user_id,
      name: s.name,
      role: s.role,
      scorePercent: Number(s.score_percent),
      criticalFail: s.critical_fail,
      notes: s.notes,
      params: Object.fromEntries((s.params as Row[]).map((p) => [p.parameter_id, p.passed])),
      fatalIds: s.fatals as string[],
    })),
  }
}

/** When the report was last really sent (null = never). Tolerant of schema_033 not being applied yet. */
export async function loadReportSentAt(sessionId: string): Promise<string | null> {
  try {
    const supabase = await getSupabaseServer()
    const { data, error } = await supabase.from('calibration_sessions').select('report_sent_at').eq('id', sessionId).maybeSingle()
    if (error || !data) return null
    return (data as { report_sent_at: string | null }).report_sent_at
  } catch {
    return null
  }
}
