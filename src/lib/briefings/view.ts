// ============================================================
// SHIKHO QA SYSTEM — Briefings, dashboard views (§5, Part B)
// Pure: sorts a person's already-scoped briefing rows into what a
// dashboard shows. WHO the rows belong to is decided by RLS (schema_021:
// auditor = own, QA Manager/Admin = all, Team Lead = own team, Manager =
// own chain, agent = own) — nothing here widens or narrows that.
// ============================================================

import { SLOT_MINUTES, dhakaMidnight } from './rules'

export interface BriefingListItem {
  id: string
  auditId: string
  agentName: string
  /** Null when the viewer's own access can't read that person's name (e.g. a Manager and a QA Auditor). */
  conductorName: string | null
  scheduledAt: string
  status: 'scheduled' | 'completed'
  attended: boolean | null
  priority: 'normal' | 'critical_same_day'
}

export interface BriefingsView {
  /** Session time has passed and attendance was never recorded — the flag. Oldest first. */
  needsAttendance: BriefingListItem[]
  /** Still to happen (or under way). Soonest first. */
  upcoming: BriefingListItem[]
  /** Recorded outcomes, most recent first. */
  recent: BriefingListItem[]
  todayCount: number
  tomorrowCount: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A slot is over once its 15 minutes have elapsed. */
export function slotHasEnded(scheduledAtIso: string, now: Date): boolean {
  return new Date(scheduledAtIso).getTime() + SLOT_MINUTES * 60_000 <= now.getTime()
}

/** Dhaka calendar days from `now` to the slot: 0 = today, 1 = tomorrow. */
function dayOffset(iso: string, now: Date): number {
  return Math.round((dhakaMidnight(new Date(iso)).getTime() - dhakaMidnight(now).getTime()) / DAY_MS)
}

export function buildBriefingsView(items: BriefingListItem[], now: Date = new Date()): BriefingsView {
  const scheduled = items.filter((i) => i.status === 'scheduled')
  const byTime = (a: BriefingListItem, b: BriefingListItem) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()

  const needsAttendance = scheduled.filter((i) => slotHasEnded(i.scheduledAt, now)).sort(byTime)
  const upcoming = scheduled.filter((i) => !slotHasEnded(i.scheduledAt, now)).sort(byTime)
  const recent = items.filter((i) => i.status === 'completed').sort((a, b) => byTime(b, a))

  return {
    needsAttendance,
    upcoming,
    recent,
    // Counts cover what is still ahead, not sessions already over.
    todayCount: upcoming.filter((i) => dayOffset(i.scheduledAt, now) === 0).length,
    tomorrowCount: upcoming.filter((i) => dayOffset(i.scheduledAt, now) === 1).length,
  }
}
