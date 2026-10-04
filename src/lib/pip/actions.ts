'use server'
// ============================================================
// SHIKHO QA SYSTEM — PIP server actions (§6.4)
// Return { ok, error } objects, never throw (§14). Every write goes through
// the session client, so row-level security and the schema_027 functions are
// the real gate; the role checks here only give friendlier messages.
//
// NO EMAIL, NO NOTIFICATION anywhere in this file except sendPipNotificationsAction
// (Stage 7) — and even that one only ever fires on a person pressing the button, and
// only actually reaches a real inbox once PIP_NOTIFICATIONS_MODE is deliberately set
// to 'live' (default 'off' sends nothing). Each change is recorded in audit_log.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { sendPipNotificationEmail } from '@/lib/users/mailer'
import { dhakaDateEndUtc, dhakaDateStartUtc } from '@/lib/dates/sales-week'
import { fmtDate } from '@/components/pip/pip-display'
import { agentNotificationHtml, agentNotificationSubject, agentNotificationText, staffNotificationHtml, staffNotificationSubject, staffNotificationText } from './notification-email'
import { buildAgentNotifications, buildStaffNotifications, type NotifyAgent, type NotifyStaff } from './notifications'
import { parseNotifyMode, parseNotifyTestRecipients, runNotifySend } from './notification-runner'
import {
  validateExclusionReason,
  validateFeedback,
  validatePolicy,
  validateTraining,
  TRAINING_NOTES_MAX,
  type PolicyInput,
} from './validation'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const ADMIN_ROLES = ['super_admin', 'qa_manager']
const QA_ROLES = ['super_admin', 'qa_manager', 'qa_auditor']

// Bug fixed here (found while adding a Manager-only action, Stage 5): the old two-way special case
// ('qa_auditor' present -> "QA staff", else "a Super Admin or QA Manager") mis-worded every OTHER
// allow-list, including the Manager-only ones added in Stage 3 -- a Team Lead requesting a PIP change
// they can't make would have been told "Only a Super Admin or QA Manager can..." instead of "Only a
// Manager can...". Now it names whoever is actually allowed.
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'a Super Admin', qa_manager: 'a QA Manager', qa_auditor: 'a QA Auditor', manager: 'a Manager', team_lead: 'a Team Lead', agent: 'an agent',
}
function allowedRolesLabel(allowed: string[]): string {
  if (allowed.length === 1) return ROLE_LABEL[allowed[0]] ?? allowed[0]
  if (JSON.stringify([...allowed].sort()) === JSON.stringify(['qa_manager', 'super_admin'])) return 'a Super Admin or QA Manager'
  if (JSON.stringify([...allowed].sort()) === JSON.stringify(['qa_auditor', 'qa_manager', 'super_admin'])) return 'QA staff'
  return allowed.map((r) => ROLE_LABEL[r] ?? r).join(' or ')
}

async function actor(allowed: string[], what: string) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' } as const
  if (!allowed.includes(user.role)) return { ok: false, error: `Only ${allowedRolesLabel(allowed)} can ${what}.` } as const
  return { ok: true, user } as const
}

/** The database's own messages are already plain language (they come from RAISE EXCEPTION); tidy the rest. */
function plain(message: string): string {
  if (/row-level security/i.test(message)) return 'You are not allowed to do that.'
  return message
}

async function log(actorId: string, action: string, recordId: string | null, after: Record<string, unknown>) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'pip', record_id: recordId, after_data: after }])
}

function refresh(cycleId?: string, candidateId?: string) {
  revalidatePath('/admin/pip')
  if (cycleId) revalidatePath(`/admin/pip/${cycleId}`)
  if (candidateId) revalidatePath(`/pip/${candidateId}`)
  revalidatePath('/pip')
  revalidatePath('/pip/review')
  if (cycleId) revalidatePath(`/pip/review/${cycleId}`)
}

// ── policy + cycles ─────────────────────────────────────────
export async function setPolicyAction(input: PolicyInput): Promise<ActionResult> {
  const a = await actor(ADMIN_ROLES, 'change the PIP policy')
  if (!a.ok) return { ok: false, error: a.error }
  const bad = validatePolicy(input)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('set_pip_policy', {
    p_revenue_benchmark: input.revenueBenchmark,
    p_vintage_min_weeks: input.vintageMinWeeks,
    p_duration_weeks: input.durationWeeks,
    p_target_revenue: input.targetRevenue,
    p_bottom_n_per_site: input.bottomNPerSite,
    p_scoped_teams: input.scopedTeams,
  })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.policy_changed', (data as string) ?? null, { ...input })
  refresh()
  return { ok: true }
}

export async function createCycleAction(month: string): Promise<ActionResult<{ id: string }>> {
  const a = await actor(ADMIN_ROLES, 'create a PIP cycle')
  if (!a.ok) return { ok: false, error: a.error }
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) return { ok: false, error: 'Pick a month.' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('create_pip_cycle', { p_month: month.length === 7 ? `${month}-01` : month })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.cycle_created', data as string, { month })
  refresh()
  return { ok: true, id: data as string }
}

export async function generateCandidatesAction(cycleId: string, acknowledgePartialRevenue: boolean): Promise<ActionResult<{ inserted: number; sharePct: number }>> {
  const a = await actor(ADMIN_ROLES, 'generate PIP suggestions')
  if (!a.ok) return { ok: false, error: a.error }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('generate_pip_candidates', {
    p_cycle_id: cycleId,
    p_acknowledge_partial_revenue: acknowledgePartialRevenue,
  })
  if (error) return { ok: false, error: plain(error.message) }
  const r = data as { inserted: number; attributed_share_pct: number }
  await log(a.user.profile.id, 'pip.suggestions_generated', cycleId, { ...r })
  refresh(cycleId)
  return { ok: true, inserted: r.inserted, sharePct: Number(r.attributed_share_pct) }
}

// ── the Manager-review workflow (§6.4, Section C, Q9/Q11) — schema_043 ──
// A Manager REQUESTS a change (never a direct edit); QA Manager/Super Admin accepts or rejects
// each one, and separately retains full unilateral authority via decideAction() above. Publishing
// is the list-level decision that finally turns every remaining 'suggested' row 'approved'.
export async function requestChangeAction(cycleId: string, agentId: string, type: 'exclude' | 'include', reason: string): Promise<ActionResult<{ id: string }>> {
  const a = await actor(['manager'], 'request a PIP list change')
  if (!a.ok) return { ok: false, error: a.error }
  if (!reason.trim()) return { ok: false, error: 'A reason is required.' }
  if (reason.length > 1000) return { ok: false, error: 'The reason can be at most 1000 characters.' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_request_change', {
    p_cycle_id: cycleId, p_agent_id: agentId, p_type: type, p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.request_created', data as string, { cycleId, agentId, type })
  refresh(cycleId)
  return { ok: true, id: data as string }
}

export async function decideRequestAction(requestId: string, cycleId: string, action: 'accept' | 'reject', note: string | null): Promise<ActionResult> {
  const a = await actor(ADMIN_ROLES, 'decide a Manager\'s PIP request')
  if (!a.ok) return { ok: false, error: a.error }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('pip_decide_request', { p_request_id: requestId, p_action: action, p_note: note })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, `pip.request_${action}ed`, requestId, { note })
  refresh(cycleId)
  return { ok: true }
}

export async function publishCycleAction(cycleId: string): Promise<ActionResult<{ approved: number }>> {
  const a = await actor(ADMIN_ROLES, 'publish a PIP cycle')
  if (!a.ok) return { ok: false, error: a.error }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_publish_cycle', { p_cycle_id: cycleId })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.cycle_published', cycleId, { approved: data })
  refresh(cycleId)
  return { ok: true, approved: Number(data) }
}

// ── the candidate workflow ──────────────────────────────────
export async function decideAction(
  candidateId: string,
  cycleId: string,
  action: 'exclude' | 'restore' | 'complete' | 'fail',
  note: string | null
): Promise<ActionResult<{ status: string }>> {
  const a = await actor(ADMIN_ROLES, 'change a PIP candidate')
  if (!a.ok) return { ok: false, error: a.error }
  if (action === 'exclude') {
    const bad = validateExclusionReason(note ?? '')
    if (bad) return { ok: false, error: bad }
  }
  const supabase = await getSupabaseServer()
  // The incentive downgrade is no longer a per-fail choice (schema_044, Q13) — it is set
  // automatically the moment a candidate is published/approved, so this call never sends it.
  const { data, error } = await supabase.rpc('pip_decide', {
    p_candidate_id: candidateId,
    p_action: action,
    p_note: note,
  })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, `pip.candidate_${action}`, candidateId, { note, status: data })
  refresh(cycleId, candidateId)
  return { ok: true, status: data as string }
}

// ── Team Lead feedback ──────────────────────────────────────
export async function addFeedbackAction(candidateId: string, feedback: string): Promise<ActionResult> {
  const a = await actor(['team_lead'], 'add PIP feedback (it is written by the agent\'s Team Leader)')
  if (!a.ok) return { ok: false, error: a.error }
  const bad = validateFeedback(feedback)
  if (bad) return { ok: false, error: bad }
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('pip_tl_feedback')
    .insert({ pip_candidate_id: candidateId, team_leader_id: a.user.profile.id, feedback: feedback.trim() })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.feedback_added', candidateId, { length: feedback.trim().length })
  refresh(undefined, candidateId)
  return { ok: true }
}

// ── training sessions ───────────────────────────────────────
export async function addTrainingAction(candidateId: string, sessionNumber: number, whenIso: string, notes: string): Promise<ActionResult> {
  const a = await actor(QA_ROLES, 'schedule a PIP training session')
  if (!a.ok) return { ok: false, error: a.error }
  const bad = validateTraining(sessionNumber, whenIso)
  if (bad) return { ok: false, error: bad }
  if (notes.length > TRAINING_NOTES_MAX) return { ok: false, error: `Notes can be at most ${TRAINING_NOTES_MAX} characters.` }
  const supabase = await getSupabaseServer()
  // The person adding it is the one conducting it (an auditor may only schedule their own; same rule as Briefings).
  const { error } = await supabase.from('pip_trainings').insert({
    pip_candidate_id: candidateId,
    session_number: sessionNumber,
    scheduled_at: new Date(whenIso).toISOString(),
    conducted_by: a.user.profile.id,
    notes: notes.trim() || null,
  })
  if (error) {
    if (error.code === '23505') return { ok: false, error: `Session ${sessionNumber} already exists for this PIP.` }
    return { ok: false, error: plain(error.message) }
  }
  await log(a.user.profile.id, 'pip.training_added', candidateId, { sessionNumber, whenIso })
  refresh(undefined, candidateId)
  return { ok: true }
}

export async function updateTrainingAction(
  trainingId: string,
  candidateId: string,
  change: { status: 'scheduled' | 'completed' | 'cancelled'; attended: boolean | null }
): Promise<ActionResult> {
  const a = await actor(QA_ROLES, 'update a PIP training session')
  if (!a.ok) return { ok: false, error: a.error }
  if (change.status === 'completed' && change.attended === null) return { ok: false, error: 'Say whether the agent attended.' }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pip_trainings')
    .update({ status: change.status, attended: change.status === 'completed' ? change.attended : null })
    .eq('id', trainingId)
    .select('id')
  if (error) return { ok: false, error: plain(error.message) }
  if (!data || data.length === 0) return { ok: false, error: 'You can only update your own training sessions.' }
  await log(a.user.profile.id, 'pip.training_updated', trainingId, { ...change })
  refresh(undefined, candidateId)
  return { ok: true }
}

// ── Stage 5: a Manager's exception on a termination-review flag — a request/record, same shape as
// the Stage 3 Manager requests, never a direct edit of the flag or the candidate. ─────────────────
export async function recordTerminationExceptionAction(
  flagId: string,
  candidateId: string,
  type: 'dismissed' | 'another_chance',
  reason: string
): Promise<ActionResult> {
  const a = await actor(['manager'], 'record a termination-review decision')
  if (!a.ok) return { ok: false, error: a.error }
  if (!reason.trim()) return { ok: false, error: 'A reason is required.' }
  if (reason.length > 1000) return { ok: false, error: 'The reason can be at most 1000 characters.' }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('pip_manager_termination_exception', {
    p_flag_id: flagId, p_type: type, p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, 'pip.termination_exception_recorded', flagId, { type })
  refresh(undefined, candidateId)
  return { ok: true }
}

// ── Stage 7: publish notification emails — manual, mode-gated, idempotent per cycle ────────────────
// Reads use the service role because they need an unrestricted view across candidates and staff
// regardless of who happens to be signed in; the ADMIN_ROLES check above stands in for RLS here,
// same shape as Calibration's report-actions.ts (calibration_report_recipients, then admin reads).
// The WRITE (notifications_sent_at/by) also uses the service role because pip_cycles has no write
// policy for any signed-in role (schema_027) -- a plain session-client UPDATE would be refused.
export async function sendPipNotificationsAction(
  cycleId: string,
  resend: boolean
): Promise<ActionResult<{ mode: 'off' | 'test' | 'live'; sent: number; skipped: number; failed: string[] }>> {
  const a = await actor(ADMIN_ROLES, 'send PIP publish notifications')
  if (!a.ok) return { ok: false, error: a.error }
  const admin = getSupabaseAdmin()

  const { data: cycle, error: cycleErr } = await admin
    .from('pip_cycles')
    .select('id, start_date, end_date, published_at, notifications_sent_at')
    .eq('id', cycleId)
    .maybeSingle()
  if (cycleErr) return { ok: false, error: plain(cycleErr.message) }
  if (!cycle) return { ok: false, error: 'That PIP cycle does not exist.' }
  if (!cycle.published_at) return { ok: false, error: 'This cycle has not been published yet.' }
  if (cycle.notifications_sent_at && !resend) {
    return { ok: false, error: `Notifications for this cycle were already sent on ${new Date(cycle.notifications_sent_at).toLocaleString()}. Confirm to send again.` }
  }

  const { data: candRows, error: candErr } = await admin
    .from('pip_candidates')
    .select('target_revenue, incentive_downgraded, agent:users!pip_candidates_agent_id_fkey(id, name, email, is_active, account_status, team_leader_id)')
    .eq('pip_cycle_id', cycleId)
    .eq('status', 'approved')
  if (candErr) return { ok: false, error: plain(candErr.message) }
  type AgentRow = { id: string; name: string; email: string; is_active: boolean; account_status: string | null; team_leader_id: string | null }
  const agents: NotifyAgent[] = (candRows ?? []).flatMap((c) => {
    const ag = (Array.isArray(c.agent) ? c.agent[0] : c.agent) as AgentRow | null
    if (!ag) return []
    return [{
      id: ag.id, name: ag.name, email: ag.email, isActive: ag.is_active, accountStatus: ag.account_status,
      teamLeaderId: ag.team_leader_id, targetRevenue: c.target_revenue === null ? null : Number(c.target_revenue),
      incentiveDowngraded: !!c.incentive_downgraded,
    }]
  })
  if (agents.length === 0) return { ok: false, error: 'This cycle has no published (approved) candidates to notify.' }

  const teamLeadIds = [...new Set(agents.map((ag) => ag.teamLeaderId).filter((id): id is string => !!id))]
  const { data: tlRows, error: tlErr } = teamLeadIds.length
    ? await admin.from('users').select('id, name, email, is_active, account_status, manager_id').in('id', teamLeadIds)
    : { data: [] as { id: string; name: string; email: string; is_active: boolean; account_status: string | null; manager_id: string | null }[], error: null }
  if (tlErr) return { ok: false, error: plain(tlErr.message) }
  const teamLeads: NotifyStaff[] = (tlRows ?? []).map((tl) => ({
    id: tl.id, name: tl.name, email: tl.email, role: 'team_lead', isActive: tl.is_active, accountStatus: tl.account_status, managerId: tl.manager_id,
  }))

  const managerIds = [...new Set(teamLeads.map((tl) => tl.managerId).filter((id): id is string => !!id))]
  const { data: mgrRows, error: mgrErr } = managerIds.length
    ? await admin.from('users').select('id, name, email, is_active, account_status').in('id', managerIds)
    : { data: [] as { id: string; name: string; email: string; is_active: boolean; account_status: string | null }[], error: null }
  if (mgrErr) return { ok: false, error: plain(mgrErr.message) }
  const managers: NotifyStaff[] = (mgrRows ?? []).map((m) => ({
    id: m.id, name: m.name, email: m.email, role: 'manager', isActive: m.is_active, accountStatus: m.account_status, managerId: null,
  }))

  const label = `${fmtDate(cycle.start_date)} – ${fmtDate(cycle.end_date)}`
  const from = dhakaDateStartUtc(cycle.start_date)
  const to = new Date(Math.min(Date.now(), dhakaDateEndUtc(cycle.end_date).getTime()))

  const agentNotifs = buildAgentNotifications(agents)
  const staffNotifs = buildStaffNotifications(agents, teamLeads, managers)
  if (agentNotifs.length === 0 && staffNotifs.length === 0) {
    return { ok: false, error: 'Nobody on this cycle has an active login to notify (every published agent, Team Lead and Manager is profile-only).' }
  }

  const targets = [
    ...(await Promise.all(agentNotifs.map(async (n) => {
      const { data: usd, error: usdErr } = await admin.rpc('agent_revenue_usd', { p_agent_id: n.recipient.id, p_from: from.toISOString(), p_to: to.toISOString() })
      const achievementUsd = usdErr ? null : Number(usd)
      const input = { label, n, achievementUsd }
      return {
        email: n.recipient.email,
        send: () => sendPipNotificationEmail(n.recipient.email, agentNotificationSubject(input), agentNotificationHtml(input), agentNotificationText(input)),
      }
    }))),
    ...staffNotifs.map((n) => {
      const input = { label, n }
      return {
        email: n.recipient.email,
        send: () => sendPipNotificationEmail(n.recipient.email, staffNotificationSubject(input), staffNotificationHtml(input), staffNotificationText(input)),
      }
    }),
  ]

  const mode = parseNotifyMode(process.env.PIP_NOTIFICATIONS_MODE)
  const result = await runNotifySend(mode, parseNotifyTestRecipients(process.env.PIP_NOTIFICATIONS_TEST_RECIPIENTS), targets)
  if (mode === 'off') return { ok: false, error: 'PIP notification emails are switched off (PIP_NOTIFICATIONS_MODE is not set). Nothing was sent.' }
  if (mode === 'test' && result.sent === 0) {
    return { ok: false, error: 'Test mode has no matching test recipients on this cycle (PIP_NOTIFICATIONS_TEST_RECIPIENTS). Nothing was sent.' }
  }

  // Only a real send counts as "sent" for idempotency -- a test-mode send leaves the button
  // available for the real one (same rule as Calibration's report_sent_at).
  if (result.mode === 'live') {
    const { error } = await admin.from('pip_cycles').update({ notifications_sent_at: new Date().toISOString(), notifications_sent_by: a.user.profile.id }).eq('id', cycleId)
    if (error) console.error('pip_cycles.notifications_sent_at not recorded:', error.message)
  }
  await log(a.user.profile.id, 'pip.notifications_sent', cycleId, { mode: result.mode, sent: result.sent, skipped: result.skippedNotAllowed, failed: result.failed.length, resend })
  refresh(cycleId)
  return { ok: true, mode: result.mode, sent: result.sent, skipped: result.skippedNotAllowed, failed: result.failed }
}
