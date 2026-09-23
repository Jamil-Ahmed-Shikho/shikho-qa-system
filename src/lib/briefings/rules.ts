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

/** Sunday..Thursday only. */
export function isBusinessDay(date: Date): boolean {
  const dow = dhakaParts(date).dow
  return dow >= 0 && dow <= 4
}

export function isThursday(date: Date): boolean {
  return dhakaParts(date).dow === 4
}

/** Exactly mirrors briefings_valid_slot in schema_021 — keep both in sync if either changes. */
export function isValidSlot(date: Date): boolean {
  const p = dhakaParts(date)
  if (date.getTime() % 60000 !== 0) return false // no seconds/ms — a slot is always on the minute
  if (!isBusinessDay(date)) return false
  if (p.minutesOfDay < COACHING_START_MIN || p.minutesOfDay > COACHING_END_MIN) return false
  return (p.minutesOfDay - COACHING_START_MIN) % SLOT_MINUTES === 0
}

/** The 17 slot start-times for the business day `dayMidnight` falls on. Empty if it isn't a business day. */
export function slotsForDay(dayMidnight: Date): Date[] {
  const start = dhakaMidnight(dayMidnight)
  if (!isBusinessDay(start)) return []
  const slots: Date[] = []
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    slots.push(new Date(start.getTime() + (COACHING_START_MIN + i * SLOT_MINUTES) * 60000))
  }
  return slots
}

/** The next `count` business days (Dhaka midnights) at or after `from`, skipping Fri/Sat. */
export function upcomingBusinessDays(from: Date, count: number): Date[] {
  const days: Date[] = []
  let cursor = dhakaMidnight(from)
  while (days.length < count) {
    if (isBusinessDay(cursor)) days.push(cursor)
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
