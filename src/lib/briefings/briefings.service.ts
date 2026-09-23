// ============================================================
// SHIKHO QA SYSTEM — Briefings service (§5, Part A)
// Server-only. Scheduling is QA-only (qa_auditor/qa_manager/super_admin —
// enforced again here, not just relied on from RLS, same pattern as
// requireUserAdmin() in users.service.ts). conducted_by is ALWAYS the
// acting user — no delegation in this UI, even though RLS itself would
// let a QA Manager/Super Admin write any conducted_by (see schema_021's
// write policies). If a delegate-picker is ever wanted, that's an
// additive UI change; nothing here or in RLS blocks it.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { AuthUser } from '@/types/database.types'
import { isValidSlot, upcomingBusinessDays, slotsForDay } from './rules'

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const SCHEDULER_ROLES = ['qa_auditor', 'qa_manager', 'super_admin'] as const

export async function requireScheduler(): Promise<AuthUser> {
  const user = await getAuthUser()
  if (!user || !(SCHEDULER_ROLES as readonly string[]).includes(user.role)) {
    throw new Error('Only QA Auditor, QA Manager or Super Admin can schedule a coaching session.')
  }
  return user
}

export interface BriefingRow {
  id: string
  audit_id: string
  agent_id: string
  scheduled_at: string
  priority: 'normal' | 'critical_same_day'
  status: 'scheduled' | 'completed' | 'cancelled'
  conducted_by: string
  attended: boolean | null
}

export interface SlotOption {
  iso: string
  isThursday: boolean
  taken: boolean
}

export interface DayOfSlots {
  dayLabel: string
  slots: SlotOption[]
}

/**
 * Everything the "Schedule Coaching?" picker needs for one audit: whether
 * it's eligible at all (submitted, not draft), its critical_fail flag (for
 * the urgent badge), any EXISTING briefing already on this audit, and the
 * acting user's own grid for the next `days` business days with
 * already-booked slots marked taken.
 */
export async function loadSchedulerData(auditId: string, days = 10) {
  const actor = await requireScheduler()
  const supabase = await getSupabaseServer()

  const { data: audit, error: auditError } = await supabase
    .from('audits')
    .select('id, status, critical_fail, agent_id')
    .eq('id', auditId)
    .single()
  if (auditError || !audit) throw new Error('Audit not found.')
  if (audit.status === 'draft') throw new Error('This audit has not been submitted yet.')

  const { data: existing } = await supabase
    .from('briefings')
    .select('id, scheduled_at, status, conducted_by, attended')
    .eq('audit_id', auditId)
    .maybeSingle()

  const { data: myBookings } = await supabase
    .from('briefings')
    .select('scheduled_at')
    .eq('conducted_by', actor.profile.id)
    .neq('status', 'cancelled')

  const takenIso = new Set((myBookings ?? []).map((b) => new Date(b.scheduled_at).toISOString()))
  // The audit's own current briefing (if rescheduling) shouldn't show as
  // "taken" against itself.
  if (existing) takenIso.delete(new Date(existing.scheduled_at).toISOString())

  const now = Date.now()
  const dayList = upcomingBusinessDays(new Date(), days).map((day): DayOfSlots => ({
    dayLabel: day.toISOString(),
    slots: slotsForDay(day)
      .filter((s) => s.getTime() > now) // never offer an already-past slot (matters for "today")
      .map((s) => ({
        iso: s.toISOString(),
        isThursday: false, // filled by the caller from rules.isThursday if needed; kept out of the payload to stay small
        taken: takenIso.has(s.toISOString()),
      })),
  }))

  return {
    audit: { id: audit.id, criticalFail: audit.critical_fail as boolean, agentId: audit.agent_id as string },
    existing: existing
      ? {
          id: existing.id as string,
          scheduledAt: existing.scheduled_at as string,
          status: existing.status as BriefingRow['status'],
          attended: existing.attended as boolean | null,
          isMine: existing.conducted_by === actor.profile.id,
        }
      : null,
    days: dayList,
  }
}

async function loadAgentAndAuditor(auditId: string) {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('audits')
    .select('agent:users!audits_agent_id_fkey(id, name, email, team_leader_id)')
    .eq('id', auditId)
    .single()
  if (error || !data) return null
  const agent = data.agent as unknown as { id: string; name: string; email: string; team_leader_id: string | null }
  if (!agent.team_leader_id) return { agent, teamLeaderEmail: null as string | null }
  const { data: tl } = await supabase.from('users').select('email').eq('id', agent.team_leader_id).single()
  return { agent, teamLeaderEmail: tl?.email ?? null }
}

export async function scheduleBriefing(auditId: string, scheduledAt: string): Promise<Result<{ agentName: string; agentEmail: string; teamLeaderEmail: string | null }>> {
  const actor = await requireScheduler()
  if (!isValidSlot(new Date(scheduledAt))) {
    return { ok: false, error: 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time).' }
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('briefings').insert({
    audit_id: auditId,
    scheduled_at: scheduledAt,
    conducted_by: actor.profile.id,
  })
  if (error) return { ok: false, error: friendlyError(error.message, error.code) }

  const names = await loadAgentAndAuditor(auditId)
  if (!names) return { ok: false, error: 'Scheduled, but could not load the agent to notify.' }
  return { ok: true, agentName: names.agent.name, agentEmail: names.agent.email, teamLeaderEmail: names.teamLeaderEmail }
}

export async function rescheduleBriefing(auditId: string, scheduledAt: string): Promise<Result<{ agentName: string; agentEmail: string; teamLeaderEmail: string | null }>> {
  const actor = await requireScheduler()
  if (!isValidSlot(new Date(scheduledAt))) {
    return { ok: false, error: 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time).' }
  }

  const supabase = await getSupabaseServer()
  const { data: existing } = await supabase.from('briefings').select('status, conducted_by').eq('audit_id', auditId).single()
  if (!existing) return { ok: false, error: 'No briefing exists for this audit yet.' }
  if (existing.status === 'completed') return { ok: false, error: 'This session already happened — it cannot be rescheduled.' }
  if (existing.conducted_by !== actor.profile.id && !['super_admin', 'qa_manager'].includes(actor.role)) {
    return { ok: false, error: "You can only reschedule your own briefings." }
  }

  const { error } = await supabase
    .from('briefings')
    .update({ scheduled_at: scheduledAt, status: 'scheduled' })
    .eq('audit_id', auditId)
  if (error) return { ok: false, error: friendlyError(error.message, error.code) }

  const names = await loadAgentAndAuditor(auditId)
  if (!names) return { ok: false, error: 'Rescheduled, but could not load the agent to notify.' }
  return { ok: true, agentName: names.agent.name, agentEmail: names.agent.email, teamLeaderEmail: names.teamLeaderEmail }
}

export async function cancelBriefing(auditId: string): Promise<Result<{ agentName: string; agentEmail: string; teamLeaderEmail: string | null }>> {
  const actor = await requireScheduler()
  const supabase = await getSupabaseServer()
  const { data: existing } = await supabase.from('briefings').select('status, conducted_by').eq('audit_id', auditId).single()
  if (!existing) return { ok: false, error: 'No briefing exists for this audit.' }
  if (existing.status !== 'scheduled') return { ok: false, error: 'Only a scheduled (not yet happened) briefing can be cancelled.' }
  if (existing.conducted_by !== actor.profile.id && !['super_admin', 'qa_manager'].includes(actor.role)) {
    return { ok: false, error: "You can only cancel your own briefings." }
  }

  const { error } = await supabase.from('briefings').update({ status: 'cancelled' }).eq('audit_id', auditId)
  if (error) return { ok: false, error: friendlyError(error.message, error.code) }

  const names = await loadAgentAndAuditor(auditId)
  if (!names) return { ok: true, agentName: '', agentEmail: '', teamLeaderEmail: null }
  return { ok: true, agentName: names.agent.name, agentEmail: names.agent.email, teamLeaderEmail: names.teamLeaderEmail }
}

export async function markAttendance(auditId: string, attended: boolean): Promise<Result> {
  const actor = await requireScheduler()
  const supabase = await getSupabaseServer()
  const { data: existing } = await supabase.from('briefings').select('status, conducted_by').eq('audit_id', auditId).single()
  if (!existing) return { ok: false, error: 'No briefing exists for this audit.' }
  if (existing.status !== 'scheduled') return { ok: false, error: 'Attendance can only be marked for a scheduled briefing.' }
  if (existing.conducted_by !== actor.profile.id && !['super_admin', 'qa_manager'].includes(actor.role)) {
    return { ok: false, error: "You can only mark attendance for your own briefings." }
  }

  const { error } = await supabase.from('briefings').update({ status: 'completed', attended }).eq('audit_id', auditId)
  if (error) return { ok: false, error: friendlyError(error.message, error.code) }
  return { ok: true }
}

function friendlyError(message: string, code?: string): string {
  if (code === '23505') {
    if (message.includes('uq_briefings_conductor_slot')) return 'That slot was just taken — please pick another.'
    if (message.includes('briefings_audit_id_key')) return 'This audit already has a briefing — reschedule it instead of creating a new one.'
    return 'That slot is no longer available.'
  }
  if (code === '23514' && message.includes('briefings_valid_slot')) {
    return 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time).'
  }
  return message
}
