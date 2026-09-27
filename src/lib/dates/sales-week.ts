// ============================================================
// SHIKHO QA SYSTEM — Sales week & reporting periods (§6.3, §9.1)
// Pure module. The sales week runs Saturday–Friday and is the
// canonical week boundary across the system. Boundaries are computed
// in Bangladesh time (UTC+6, no daylight saving) so a Friday-night
// audit doesn't slip into the next week on a UTC server.
// ============================================================

const BD_OFFSET_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The instant the current sales week began: Saturday 00:00 Dhaka time. */
export function salesWeekStart(now: Date): Date {
  const shifted = new Date(now.getTime() + BD_OFFSET_MS)
  // getUTCDay on the shifted clock: Sun=0 … Sat=6 → days since Saturday.
  const daysSinceSaturday = (shifted.getUTCDay() + 1) % 7
  const startShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysSinceSaturday
  )
  return new Date(startShifted - BD_OFFSET_MS)
}

export type Period = 'this_week' | 'last_week' | 'last_30'

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'this_week', label: 'This sales week' },
  { value: 'last_week', label: 'Last sales week' },
  { value: 'last_30', label: 'Last 30 days' },
]

export function parsePeriod(raw: string | undefined): Period {
  return PERIOD_OPTIONS.some((p) => p.value === raw) ? (raw as Period) : 'this_week'
}

/** Half-open range [from, to). */
export function periodRange(period: Period, now: Date = new Date()): { from: Date; to: Date } {
  const weekStart = salesWeekStart(now)
  switch (period) {
    case 'this_week':
      return { from: weekStart, to: new Date(weekStart.getTime() + 7 * DAY_MS) }
    case 'last_week':
      return { from: new Date(weekStart.getTime() - 7 * DAY_MS), to: weekStart }
    case 'last_30':
      // +1 minute so an audit submitted a moment ago is included.
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: new Date(now.getTime() + 60_000) }
  }
}

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' })

export function describeRange(range: { from: Date; to: Date }): string {
  return `${fmt.format(range.from)} – ${fmt.format(new Date(range.to.getTime() - 1))}`
}

const dhakaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }) // YYYY-MM-DD

/** The Saturday that starts the current sales week, as a Dhaka calendar date 'YYYY-MM-DD' (matches agent_weekly_sales.week_start). */
export function salesWeekStartDate(now: Date): string {
  return dhakaDate.format(salesWeekStart(now))
}

/** The Saturday that started the sales week BEFORE the current one, 'YYYY-MM-DD'. */
export function previousSalesWeekStartDate(now: Date): string {
  return dhakaDate.format(new Date(salesWeekStart(now).getTime() - 7 * DAY_MS))
}

/** The instant Dhaka midnight begins for a 'YYYY-MM-DD' Dhaka calendar date (a half-open range's `from`). */
export function dhakaDateStartUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - BD_OFFSET_MS)
}

/** The instant just after a 'YYYY-MM-DD' Dhaka calendar date ends — an exclusive upper bound that includes the whole of that date. */
export function dhakaDateEndUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1) - BD_OFFSET_MS)
}
