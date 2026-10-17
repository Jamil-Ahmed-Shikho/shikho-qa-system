// ============================================================
// SHIKHO QA SYSTEM — Briefings slot rules (§5)
// Pure module. Mirrors supabase/schema_021_briefings.sql's
// briefings_valid_slot CHECK constraint exactly — a randomized parity
// test (test-briefings-rules in the scratchpad) keeps the two in sync,
// same discipline as scoring.ts / rules.ts elsewhere in this system.
//
// Coaching window: 11:00 AM-3:00 PM (last slot STARTS 3:00, ends 3:15),
// Sunday-Thursday only, Asia/Dhaka. Same fixed-offset convention as
// src/lib/dates/sales-week.ts (Bangladesh doesn't observe DST, so a
// constant +6h shift is exact, not an approximation).
//
// Day-swaps (schema_098, 2026-10-17): the CHECK constraint now only
// mirrors the TIME/15-min-grid shape below — it can no longer enforce
// Sun-Thu, since that's holiday-calendar-dependent and a CHECK can't query
// another table. Day validity (including a holiday closing a normally-open
// day, or a working_day entry opening a normally-closed one) is enforced
// by the `enforce_briefing_day_open` trigger instead, the real boundary.
// `isBusinessDay` stays the pure Sun-Thu DEFAULT; `isOpenDay` layers any
// `DayException[]` on top of it, and every exported slot function below
// takes an optional `exceptions` param (default `[]` = identical to the
// old behaviour) so every existing caller keeps compiling unchanged.
// ============================================================

const BD_OFFSET_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const SLOT_MINUTES = 15
const COACHING_START_MIN = 11 * 60 // minutes after midnight, Dhaka
const COACHING_END_MIN = 15 * 60 // last slot's OWN start time
export const SLOTS_PER_DAY = (COACHING_END_MIN - COACHING_START_MIN) / SLOT_MINUTES + 1 // 17

interface DhakaParts {
  year: number
  month: number // 0-11
  day: number
  hour: number
  minute: number
  /** 0=Sunday … 6=Saturday, in Dhaka local time. */
  dow: number
  minutesOfDay: number
}

function dhakaParts(date: Date): DhakaParts {
  const shifted = new Date(date.getTime() + BD_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

/** Dhaka midnight (00:00 local) for the calendar day `date` falls on, as a real instant. */
export function dhakaMidnight(date: Date): Date {
  const p = dhakaParts(date)
  return new Date(Date.UTC(p.year, p.month, p.day) - BD_OFFSET_MS)
}

/** Sunday..Thursday only. The pure DEFAULT — never holiday-aware on its own, see isOpenDay. */
export function isBusinessDay(date: Date): boolean {
  const dow = dhakaParts(date).dow
  return dow >= 0 && dow <= 4
}

export function isThursday(date: Date): boolean {
  return dhakaParts(date).dow === 4
}

/** A holiday-calendar override for one Dhaka calendar date (schema_098). `date` is 'YYYY-MM-DD'. */
export interface DayException {
  date: string
  kind: 'holiday' | 'working_day'
}

function dhakaDateStr(date: Date): string {
  const p = dhakaParts(date)
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** isBusinessDay, overridden by a matching exception — a 'holiday' closes an otherwise-open day,
 *  a 'working_day' opens an otherwise-closed one. No exception = unchanged default behaviour. */
export function isOpenDay(date: Date, exceptions: DayException[] = []): boolean {
  const ds = dhakaDateStr(date)
  const match = exceptions.find((e) => e.date === ds)
  if (match?.kind === 'holiday') return false
  if (match?.kind === 'working_day') return true
  return isBusinessDay(date)
}

/** Exactly mirrors briefings_valid_slot's TIME shape in schema_021/098 — day validity (isOpenDay)
 *  is enforced by the enforce_briefing_day_open trigger, not the CHECK; keep both in sync. */
export function isValidSlot(date: Date, exceptions: DayException[] = []): boolean {
  const p = dhakaParts(date)
  if (date.getTime() % 60000 !== 0) return false // no seconds/ms — a slot is always on the minute
  if (!isOpenDay(date, exceptions)) return false
  if (p.minutesOfDay < COACHING_START_MIN || p.minutesOfDay > COACHING_END_MIN) return false
  return (p.minutesOfDay - COACHING_START_MIN) % SLOT_MINUTES === 0
}

/** The 17 slot start-times for the day `dayMidnight` falls on. Empty if it isn't an open day. */
export function slotsForDay(dayMidnight: Date, exceptions: DayException[] = []): Date[] {
  const start = dhakaMidnight(dayMidnight)
  if (!isOpenDay(start, exceptions)) return []
  const slots: Date[] = []
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    slots.push(new Date(start.getTime() + (COACHING_START_MIN + i * SLOT_MINUTES) * 60000))
  }
  return slots
}

/** The next `count` open days (Dhaka midnights) at or after `from`, skipping closed ones. */
export function upcomingBusinessDays(from: Date, count: number, exceptions: DayException[] = []): Date[] {
  const days: Date[] = []
  let cursor = dhakaMidnight(from)
  while (days.length < count) {
    if (isOpenDay(cursor, exceptions)) days.push(cursor)
    cursor = new Date(cursor.getTime() + DAY_MS)
  }
  return days
}

const dayLabelFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' })
const timeLabelFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' })

export function formatSlotDay(date: Date): string {
  return dayLabelFmt.format(date)
}

export function formatSlotTime(date: Date): string {
  return timeLabelFmt.format(date)
}

/**
 * How far a date is from today, in Dhaka calendar days, as words: "today",
 * "tomorrow", "yesterday", "in 5 days", "12 days ago". Compares Dhaka
 * calendar days (not 24-hour spans), so a session at 11 AM yesterday is
 * "yesterday" even if it was only 20 hours ago.
 */
export function relativeDayLabel(date: Date, now: Date = new Date()): string {
  const diff = Math.round((dhakaMidnight(date).getTime() - dhakaMidnight(now).getTime()) / DAY_MS)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`
}
