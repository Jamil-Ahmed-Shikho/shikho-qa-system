'use server'
// ============================================================
// SHIKHO QA SYSTEM — Calibration sessions server actions (§5, Stage 1)
// Return { ok, error } objects, never throw (§14). Writes go through the
// session client to the schema_031 functions, which are the real gate.
// The call is re-fetched from the CRM here (never trusted from the browser),
// exactly as startAudit does. NO EMAIL / NOTIFICATION in this stage.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { CrmApiError, getCallById } from '@/lib/crm/client'
import { crmTimestamp } from '@/lib/crm/time.mjs'
import { loadCandidates } from './calibration.service'
import { parseDhakaLocal, validateSession, type SessionInput } from './validation'
import { createNotifications } from '@/lib/notifications/notifications.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const SCHEDULER_ROLES = ['super_admin', 'qa_manager', 'qa_auditor']

function plain(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return 'You are not allowed to do that.'
  return message
}

async function log(actorId: string, action: string, recordId: string | null, after: Record<string, unknown>) {
  await writeAuditLogs([{ actor_id: actorId, action, table_name: 'calibration_sessions', record_id: recordId, after_data: after }])
}

function refresh(id?: string) {
  revalidatePath('/calibration')
  if (id) revalidatePath(`/calibration/${id}`)
}

export async function createSessionAction(input: SessionInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (!SCHEDULER_ROLES.includes(user.role)) {
      return { ok: false, error: 'Only QA Auditors, QA Managers and Super Admins can schedule a calibration session.' }
    }
    const candidates = await loadCandidates()
    const bad = validateSession(input, candidates)
    if (bad) return { ok: false, error: bad }
    const scheduledAt = parseDhakaLocal(input.scheduledLocal)

    let call: Awaited<ReturnType<typeof getCallById>> = null
    if (input.itemType === 'call') {
      try {
        call = await getCallById(input.callId, user.profile.id)
      } catch (err) {
        const clientError = err instanceof CrmApiError && err.status !== undefined && err.status >= 400 && err.status < 500
        if (!clientError) return { ok: false, error: 'Could not reach the CRM to verify this call — please try again.' }
      }
      if (!call || String(call.lead_id) !== String(input.leadId)) {
        return { ok: false, error: 'That call was not found on this lead in the CRM.' }
      }
    }

    const supabase = await getSupabaseServer()
    const { data, error } = await supabase.rpc('create_calibration_session', {
      p_kind: input.kind,
      p_title: input.title.trim() || null,
      p_item_type: input.itemType,
      p_item_reference: input.itemType === 'call' ? null : input.itemReference.trim(),
      p_crm_lead_id: call ? String(call.lead_id) : null,
      p_crm_call_id: call ? String(call.id) : null,
      p_call_started_at: call ? crmTimestamp(call.started_at) : null,
      p_call_ended_at: call ? crmTimestamp(call.ended_at) : null,
      p_call_recording_url: call?.recording_url ?? null,
      p_call_status: call?.call_status ?? null,
      p_call_destination: call ? (call.destination_number ?? call.destination ?? null) : null,
      p_rubric_id: input.rubricId,
      p_team_name: input.teamName,
      p_site_name: input.siteName,
      p_scheduled_at: scheduledAt,
      p_participant_ids: input.participantIds,
    })
    if (error) return { ok: false, error: plain(error.message) }
    const id = data as string
    await log(user.profile.id, 'calibration.created', id, {
      kind: input.kind, team: input.teamName, site: input.siteName, scheduled_at: scheduledAt, invited: input.participantIds.length,
    })

    // In-app notification (schema_064) to every OTHER invited participant — not the scheduler, who
    // already knows (they just did it).
    const others = input.participantIds.filter((p) => p !== user.profile.id)
    await createNotifications(
      others.map((recipientId) => ({
        recipientId,
        type: 'calibration_scheduled' as const,
        title: 'Calibration session scheduled',
        body: `${user.profile.name} scheduled a calibration session (${input.teamName}, ${input.siteName}) for ${formatDhakaDateTime(scheduledAt)}.`,
        link: `/calibration/${id}`,
        relatedTable: 'calibration_sessions',
        relatedId: id,
      }))
    )

    refresh(id)
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}

export async function updateSessionAction(
  id: string,
  title: string,
  scheduledLocal: string,
  participantIds: string[]
): Promise<ActionResult> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    const iso = parseDhakaLocal(scheduledLocal)
    if (!iso) return { ok: false, error: 'Choose a date and time.' }
    if (title.length > 100) return { ok: false, error: 'The title can be at most 100 characters.' }
    const supabase = await getSupabaseServer()
    const { error } = await supabase.rpc('update_calibration_session', {
      p_id: id,
      p_title: title.trim() || null,
      p_scheduled_at: iso,
      p_participant_ids: participantIds,
    })
    if (error) return { ok: false, error: plain(error.message) }
    await log(user.profile.id, 'calibration.updated', id, { scheduled_at: iso, invited: participantIds.length })
    refresh(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}

export async function cancelSessionAction(id: string): Promise<ActionResult> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    const supabase = await getSupabaseServer()
    const { error } = await supabase.rpc('cancel_calibration_session', { p_id: id })
    if (error) return { ok: false, error: plain(error.message) }
    await log(user.profile.id, 'calibration.cancelled', id, {})
    refresh(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}

export async function submitScoreAction(
  sessionId: string,
  marks: { parameter_id: string; passed: boolean }[],
  fatalIds: string[],
  notes: string
): Promise<ActionResult<{ score: number }>> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (notes.length > 2000) return { ok: false, error: 'Notes can be at most 2000 characters.' }
    const supabase = await getSupabaseServer()
    const { data, error } = await supabase.rpc('submit_calibration_score', {
      p_session_id: sessionId,
      p_marks: marks,
      p_fatals: fatalIds,
      p_notes: notes.trim() || null,
    })
    if (error) return { ok: false, error: plain(error.message) }
    await log(user.profile.id, 'calibration.score_submitted', sessionId, { score: Number(data) })
    refresh(sessionId)
    return { ok: true, score: Number(data) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}

export async function closeSessionAction(id: string): Promise<ActionResult> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    const supabase = await getSupabaseServer()
    const { error } = await supabase.rpc('close_calibration_session', { p_id: id })
    if (error) return { ok: false, error: plain(error.message) }
    await log(user.profile.id, 'calibration.closed', id, {})
    refresh(id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? plain(err.message) : 'Something went wrong.' }
  }
}
