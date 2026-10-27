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
import { isBusinessDay, isValidSlot, upcomingBusinessDays, slotsForDay, type DayException } from './rules'
import { loadHolidayExceptions } from '@/lib/holidays/holidays.service'
import { buildBriefingsView, type BriefingListItem, type BriefingsView } from './view'

// How far ahead to fetch holiday-calendar overrides for scheduling — comfortably covers the
// `days`-business-day scan in loadSchedulerData() even through a holiday cluster, and the single
// target date scheduleBriefing/rescheduleBriefing validate (schema_098, 2026-10-17).
const EXCEPTIONS_WINDOW_DAYS = 60

async function loadSchedulingExceptions(siteName: string | null, from: Date = new Date()): Promise<DayException[]> {
  const fromStr = from.toISOString().slice(0, 10)
  const toStr = new Date(from.getTime() + EXCEPTIONS_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  try {
    return await loadHolidayExceptions(fromStr, toStr, siteName)
  } catch {
    return [] // the holiday calendar is supplementary here — a failed read must not block scheduling
  }
}

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

export interface CoachingHistoryItem {
  briefingId: string
  auditId: string
  scheduledAt: string
  status: 'scheduled' | 'completed'
  attended: boolean | null
  priority: 'normal' | 'critical_same_day'
  conductorName: string
}

/** Who to email, and who is conducting — everything the notification needs. */
export interface NotifyInfo {
  agentName: string
  agentEmail: string
  teamLeaderEmail: string | null
  managerEmail: string | null
  conductorName: string
}

/**
 * An agent's whole coaching history (sessions with ANY auditor, cancelled
 * ones excluded), newest first — via agent_coaching_history() (schema_024),
 * because a QA Auditor can only read the briefings they conduct themselves.
 * Throws on a failed read: an error must never look like "no history",
 * which would invite a double-booking.
 */
export async function loadAgentCoachingHistory(agentId: string): Promise<CoachingHistoryItem[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('agent_coaching_history', { p_agent_id: agentId })
  if (error) throw new Error(`Could not load the coaching history: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    briefingId: r.briefing_id as string,
    auditId: r.audit_id as string,
    scheduledAt: r.scheduled_at as string,
    status: r.status as CoachingHistoryItem['status'],
    attended: (r.attended as boolean | null) ?? null,
    priority: r.priority as CoachingHistoryItem['priority'],
    conductorName: r.conductor_name as string,
  }))
}

export interface DayOfSlots {
  dayLabel: string
  slots: SlotOption[]
  /** Set when this day is only open because of a working_day calendar override (schema_098) —
   *  a holiday-closed day simply doesn't appear in the list at all, so only this case needs a label. */
  isExtraWorkingDay?: boolean
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

  const history = await loadAgentCoachingHistory(audit.agent_id as string)

  const takenIso = new Set((myBookings ?? []).map((b) => new Date(b.scheduled_at).toISOString()))
  // The audit's own current briefing (if rescheduling) shouldn't show as
  // "taken" against itself.
  if (existing) takenIso.delete(new Date(existing.scheduled_at).toISOString())

  // Day swaps (schema_098) — scoped to the SCHEDULER's own site, since it's their physical
  // attendance/grid that determines whether a given calendar date is actually open for them.
  const exceptions = await loadSchedulingExceptions(actor.profile.site_name)

  const now = Date.now()
  const dayList = upcomingBusinessDays(new Date(), days, exceptions).map((day): DayOfSlots => ({
    dayLabel: day.toISOString(),
    isExtraWorkingDay: !isBusinessDay(day) ? true : undefined,
    slots: slotsForDay(day, exceptions)
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
    history,
  }
}

// Who to notify, and who is conducting. Read AFTER the write, so the
// briefing row exists in all three cases (scheduled / rescheduled / cancelled);
// the conductor is the briefing's own conducted_by — not necessarily the
// person acting (a QA Manager can reschedule or cancel someone else's).
async function loadNotifyInfo(auditId: string): Promise<NotifyInfo | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('audits')
    .select('agent:users!audits_agent_id_fkey(id, name, email, team_leader_id)')
    .eq('id', auditId)
    .single()
  if (error || !data) return null
  const agent = data.agent as unknown as { id: string; name: string; email: string; team_leader_id: string | null }

  const { data: briefing } = await supabase
    .from('briefings')
    .select('conductor:users!briefings_conducted_by_fkey(name)')
    .eq('audit_id', auditId)
    .single()
  const conductorName = (briefing?.conductor as unknown as { name: string } | null)?.name
  if (!conductorName) return null

  let teamLeaderEmail: string | null = null
  let managerEmail: string | null = null
  if (agent.team_leader_id) {
    const { data: tl } = await supabase.from('users').select('email, manager_id').eq('id', agent.team_leader_id).single()
    teamLeaderEmail = tl?.email ?? null
    if (tl?.manager_id) {
      const { data: mgr } = await supabase.from('users').select('email, is_active, account_status').eq('id', tl.manager_id).single()
      // Same "a real login exists" eligibility rule used everywhere else an email goes out
      // (Briefings digest, audit-notifications.ts, PIP) — a profile_only Manager hasn't been
      // invited to the system yet, so a direct notification about it would be confusing.
      if (mgr?.is_active && mgr.account_status === 'active' && mgr.email) managerEmail = mgr.email
    }
  }
  return { agentName: agent.name, agentEmail: agent.email, teamLeaderEmail, managerEmail, conductorName }
}

export async function scheduleBriefing(auditId: string, scheduledAt: string): Promise<Result<NotifyInfo>> {
  const actor = await requireScheduler()
  const target = new Date(scheduledAt)
  const exceptions = await loadSchedulingExceptions(actor.profile.site_name, target)
  if (!isValidSlot(target, exceptions)) {
    return { ok: false, error: 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time — unless a holiday-calendar swap opens or closes that date).' }
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('briefings').insert({
    audit_id: auditId,
    scheduled_at: scheduledAt,
    conducted_by: actor.profile.id,
  })
  if (error) return { ok: false, error: friendlyError(error.message, error.code) }

  const info = await loadNotifyInfo(auditId)
  if (!info) return { ok: false, error: 'Scheduled, but could not load who to notify.' }
  return { ok: true, ...info }
}

export async function rescheduleBriefing(auditId: string, scheduledAt: string): Promise<Result<NotifyInfo>> {
  const actor = await requireScheduler()
  const target = new Date(scheduledAt)
  const exceptions = await loadSchedulingExceptions(actor.profile.site_name, target)
  if (!isValidSlot(target, exceptions)) {
    return { ok: false, error: 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time — unless a holiday-calendar swap opens or closes that date).' }
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

  const info = await loadNotifyInfo(auditId)
  if (!info) return { ok: false, error: 'Rescheduled, but could not load who to notify.' }
  return { ok: true, ...info }
}

export async function cancelBriefing(auditId: string): Promise<Result<NotifyInfo>> {
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

  const info = await loadNotifyInfo(auditId)
  if (!info) return { ok: true, agentName: '', agentEmail: '', teamLeaderEmail: null, managerEmail: null, conductorName: '' }
  return { ok: true, ...info }
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
    if (message.includes('uq_briefings_agent_slot')) return 'This agent already has a coaching session booked at that exact date and time — pick a different slot.'
    if (message.includes('briefings_audit_id_key')) return 'This audit already has a briefing — reschedule it instead of creating a new one.'
    return 'That slot is no longer available.'
  }
  if (code === '23514' && message.includes('briefings_valid_slot')) {
    return 'That is not a valid coaching slot (11:00 AM-3:00 PM, Sunday-Thursday, Dhaka time).'
  }
  // The enforce_briefing_day_open trigger (schema_098) — day validity, now holiday-calendar-aware,
  // can no longer live in the CHECK above.
  if (code === 'P0001' && message.includes('not open for coaching sessions')) {
    return 'That date is closed for coaching sessions — check the holiday calendar for a swap on that day.'
  }
  return message
}

// ── Dashboard views (Part B) ─────────────────────────────────
// Read-only, and deliberately NOT gated by requireScheduler(): Team Leads,
// Managers and agents look but can't schedule. Who sees which rows is the
// briefings table's own RLS (schema_021), so this asks for "my briefings"
// and gets exactly the slice the signed-in role is allowed.

const VIEW_ROW_LIMIT = 1000

export interface BriefingsLoad {
  view: BriefingsView
  /** More rows exist than were fetched — the counts are a floor, and the screen says so. */
  truncated: boolean
}

/**
 * Throws on a failed read: an error must never look like "nothing scheduled"
 * (same rule as loadAgentCoachingHistory). Cancelled sessions are left out —
 * they are on record but no longer part of anyone's calendar.
 */
export async function loadBriefingsView(now: Date = new Date()): Promise<BriefingsLoad> {
  const supabase = await getSupabaseServer()
  const recentSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Every session still on the calendar (scheduled), plus the last 30 days of recorded outcomes.
  const { data, error } = await supabase
    .from('briefings')
    .select(
      'id, audit_id, scheduled_at, status, attended, priority, ' +
        'agent:users!briefings_agent_id_fkey(name), conductor:users!briefings_conducted_by_fkey(name)'
    )
    .or(`status.eq.scheduled,and(status.eq.completed,scheduled_at.gte.${recentSince})`)
    .order('scheduled_at', { ascending: true })
    .limit(VIEW_ROW_LIMIT)
  if (error) throw new Error(`Could not load briefings: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<{
    id: string; audit_id: string; scheduled_at: string; status: 'scheduled' | 'completed'
    attended: boolean | null; priority: 'normal' | 'critical_same_day'
    agent: { name: string } | null; conductor: { name: string } | null
  }>

  const items: BriefingListItem[] = rows.map((r) => ({
    id: r.id,
    auditId: r.audit_id,
    agentName: r.agent?.name ?? 'Unknown agent',
    conductorName: r.conductor?.name ?? null,
    scheduledAt: r.scheduled_at,
    status: r.status,
    attended: r.attended,
    priority: r.priority,
  }))
  return { view: buildBriefingsView(items, now), truncated: rows.length >= VIEW_ROW_LIMIT }
}
