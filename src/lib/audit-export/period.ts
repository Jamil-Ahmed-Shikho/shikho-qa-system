// ============================================================
// SHIKHO QA SYSTEM — Raw Audit Data Export: period options (2026-11-01)
// Pure module. This screen's own period set — This sales week / Last
// sales week / Last 30 days (the existing shared convention, reused as-is
// from src/lib/dates/sales-week.ts) PLUS Current/Last calendar month and
// a custom range capped at 30 days, which nothing else in this app has
// needed before. Kept as its OWN type/option list rather than widening
// the shared `Period`/`PERIOD_OPTIONS` used by every dashboard, so this
// export's extra options never leak onto a screen that was never asked
// to grow them.
// ============================================================

import { salesWeekStart, dhakaDateStartUtc, dhakaDateEndUtc } from '@/lib/dates/sales-week'

export type ExportPeriod = 'this_week' | 'last_week' | 'last_30' | 'this_month' | 'last_month' | 'custom'

export const EXPORT_PERIOD_OPTIONS: { value: ExportPeriod; label: string }[] = [
  { value: 'this_week', label: 'This sales week' },
  { value: 'last_week', label: 'Last sales week' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'this_month', label: 'Current month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
]

export function parseExportPeriod(raw: string | undefined): ExportPeriod {
  return EXPORT_PERIOD_OPTIONS.some((p) => p.value === raw) ? (raw as ExportPeriod) : 'this_week'
}

export class ExportRangeError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CUSTOM_DAYS = 30

const dhakaYearMonthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' })

function dhakaYearMonth(now: Date): { y: number; m: number } {
  const parts = dhakaYearMonthFmt.formatToParts(now)
  return {
    y: Number(parts.find((p) => p.type === 'year')!.value),
    m: Number(parts.find((p) => p.type === 'month')!.value),
  }
}

/** Half-open [from, to) for a Dhaka calendar month — reuses dhakaDateStartUtc on the 1st of each
 *  month rather than re-deriving the +06:00 offset arithmetic a second time. */
function monthRange(y: number, m: number): { from: Date; to: Date } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const from = dhakaDateStartUtc(`${y}-${pad(m)}-01`)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const to = dhakaDateStartUtc(`${nextY}-${pad(nextM)}-01`)
  return { from, to }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Resolves a period (+ custom from/to when period === 'custom') to a half-open [from, to) range.
 *  Throws ExportRangeError — caught by the route handler and turned into a 400 — for a missing,
 *  malformed, backwards, or over-30-day custom range; never silently clamps one. */
export function resolveExportRange(
  period: ExportPeriod, customFrom: string | undefined, customTo: string | undefined, now: Date = new Date()
): { from: Date; to: Date } {
  switch (period) {
    case 'this_week': {
      const weekStart = salesWeekStart(now)
      return { from: weekStart, to: new Date(weekStart.getTime() + 7 * DAY_MS) }
    }
    case 'last_week': {
      const weekStart = salesWeekStart(now)
      return { from: new Date(weekStart.getTime() - 7 * DAY_MS), to: weekStart }
    }
    case 'last_30':
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: new Date(now.getTime() + 60_000) }
    case 'this_month': {
      const { y, m } = dhakaYearMonth(now)
      return monthRange(y, m)
    }
    case 'last_month': {
      const { y, m } = dhakaYearMonth(now)
      return monthRange(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1)
    }
    case 'custom': {
      if (!customFrom || !customTo) throw new ExportRangeError('Pick a start and end date for a custom range.')
      if (!DATE_RE.test(customFrom) || !DATE_RE.test(customTo)) throw new ExportRangeError('Dates must be in YYYY-MM-DD form.')
      const from = dhakaDateStartUtc(customFrom)
      const to = dhakaDateEndUtc(customTo)
      if (to <= from) throw new ExportRangeError('The end date must be on or after the start date.')
      const days = Math.round((to.getTime() - from.getTime()) / DAY_MS)
      if (days > MAX_CUSTOM_DAYS) throw new ExportRangeError(`A custom range can cover at most ${MAX_CUSTOM_DAYS} days — pick a shorter span.`)
      return { from, to }
    }
  }
}
