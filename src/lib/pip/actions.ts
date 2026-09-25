'use server'
// ============================================================
// SHIKHO QA SYSTEM — PIP server actions (§6.4)
// Return { ok, error } objects, never throw (§14). Every write goes through
// the session client, so row-level security and the schema_027 functions are
// the real gate; the role checks here only give friendlier messages.
//
// NO EMAIL, NO NOTIFICATION — by design. PIP messages to real people are held
// for a human review; nothing in this file (or anything it calls) sends one.
// Each change is recorded in audit_log.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
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

async function actor(allowed: string[], what: string) {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' } as const
  if (!allowed.includes(user.role)) return { ok: false, error: `Only ${allowed.includes('qa_auditor') ? 'QA staff' : 'a Super Admin or QA Manager'} can ${what}.` } as const
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
    p_vintage_min_days: input.vintageMinDays,
    p_duration_weeks: input.durationWeeks,
    p_target_revenue: input.targetRevenue,
    p_bottom_n_per_site: input.bottomNPerSite,
    p_revenue_window_weeks: input.revenueWindowWeeks,
    p_revenue_unit: input.revenueUnit,
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

// ── the candidate workflow ──────────────────────────────────
export async function decideAction(
  candidateId: string,
  cycleId: string,
  action: 'exclude' | 'restore' | 'approve' | 'complete' | 'fail',
  note: string | null,
  downgrade = false
): Promise<ActionResult<{ status: string }>> {
  const a = await actor(ADMIN_ROLES, 'change a PIP candidate')
  if (!a.ok) return { ok: false, error: a.error }
  if (action === 'exclude') {
    const bad = validateExclusionReason(note ?? '')
    if (bad) return { ok: false, error: bad }
  }
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('pip_decide', {
    p_candidate_id: candidateId,
    p_action: action,
    p_note: note,
    p_downgrade: downgrade,
  })
  if (error) return { ok: false, error: plain(error.message) }
  await log(a.user.profile.id, `pip.candidate_${action}`, candidateId, { note, downgrade, status: data })
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
