// ============================================================
// SHIKHO QA SYSTEM — Rubric Fail Trends: pure analysis helpers (severity
// thresholds, small-sample flag, sparkline shaping). No
// server imports — same "pure, unit-testable" convention as
// src/lib/queue/priority.ts and src/lib/manager/rollup.ts. The SQL
// (qa_rubric_fail_trends / qa_rubric_fail_trend_history, schema_090) returns
// facts; the presentation decisions live here so they're in one place and
// can be read/tested without a database.
// ============================================================

import { salesWeekStartDate } from '@/lib/dates/sales-week'
import type { RubricFailTrendRow, WeeklyFailPoint } from './qa-rubric-trends.service'

/** Below this many scored audits, a fail rate is noisy enough that it shouldn't be read at face
 *  value (e.g. "100%" on 2 calls looks identical to "100%" on 50 without this). Not specified by
 *  Jamil — a reasonable default, easy to tune later if it's too strict/loose in practice. */
export const SMALL_SAMPLE_THRESHOLD = 10

export function isSmallSample(totalScored: number): boolean {
  return totalScored < SMALL_SAMPLE_THRESHOLD
}

export type Severity = 'high' | 'moderate' | 'low'

/** Fail-rate severity tiers for the color cue. Not specified — a reasonable 3-tier split, easy to
 *  retune: 40%+ is a parameter failing on more calls than not (high), 20-39.9% is a real but less
 *  urgent gap (moderate), under 20% reads as fine (low). */
export function failRateSeverity(failRatePct: number): Severity {
  if (failRatePct >= 40) return 'high'
  if (failRatePct >= 20) return 'moderate'
  return 'low'
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface SparklinePoint {
  weekStart: string
  /** null = no scored audits that week — a gap, not a 0% fail rate. */
  failRatePct: number | null
  totalScored: number
}

/** Builds a continuous week-by-week series for one parameter from the sparse history rows, filling
 *  any week with nothing scored as a gap (null) rather than a misleading 0%. `weekStarts` is the full
 *  trailing list of sales-week start dates to plot (oldest first), computed by the caller so every
 *  parameter's sparkline shares the same x-axis even if some weeks have no data for it at all. */
export function buildSparkline(parameterId: string, history: WeeklyFailPoint[], weekStarts: string[]): SparklinePoint[] {
  const byWeek = new Map(history.filter((h) => h.parameterId === parameterId).map((h) => [h.weekStart, h]))
  return weekStarts.map((weekStart) => {
    const h = byWeek.get(weekStart)
    return { weekStart, failRatePct: h ? h.failRatePct : null, totalScored: h ? h.totalScored : 0 }
  })
}

export interface WeekOverWeek {
  lastWeekPct: number | null
  lastWeekScored: number
  thisWeekPct: number | null
  thisWeekScored: number
  /** this week minus last week, in percentage points — null when either week has nothing scored. */
  trendDeltaPct: number | null
}

/** Reads the last two points of the same trailing-weeks history already fetched for the sparkline —
 *  the most recently completed sales week ("last week") and the current, possibly in-progress one
 *  ("this week") — and derives a simple, always-the-same-two-weeks comparison, independent of
 *  whatever period (This week / Last week / Last 30 days) is picked for the rest of the page. Jamil's
 *  own ask: "last week vs current week ... where performance down" — a fixed, easy-to-read pair, not
 *  a period-relative one. `weekStarts` must be the same oldest-first list `buildSparkline()` uses, so
 *  the two series never disagree about which week is "this week". */
export function weekOverWeek(parameterId: string, history: WeeklyFailPoint[], weekStarts: string[]): WeekOverWeek {
  const thisWeekStart = weekStarts[weekStarts.length - 1]
  const lastWeekStart = weekStarts[weekStarts.length - 2]
  const byWeek = new Map(history.filter((h) => h.parameterId === parameterId).map((h) => [h.weekStart, h]))
  const thisWeek = thisWeekStart ? byWeek.get(thisWeekStart) : undefined
  const lastWeek = lastWeekStart ? byWeek.get(lastWeekStart) : undefined
  const thisWeekPct = thisWeek ? thisWeek.failRatePct : null
  const lastWeekPct = lastWeek ? lastWeek.failRatePct : null
  return {
    lastWeekPct, lastWeekScored: lastWeek?.totalScored ?? 0,
    thisWeekPct, thisWeekScored: thisWeek?.totalScored ?? 0,
    trendDeltaPct: thisWeekPct !== null && lastWeekPct !== null ? round1(thisWeekPct - lastWeekPct) : null,
  }
}

/** The trailing N sales-week start dates (oldest first), as 'YYYY-MM-DD' Dhaka calendar dates, ending
 *  at the current sales week — mirrors the SQL function's own `sales_week_start(now()) - (weeks-1)*7`
 *  so the client-built x-axis always lines up with what the server actually grouped by. Built on the
 *  existing `salesWeekStartDate()` (src/lib/dates/sales-week.ts) rather than re-deriving the Dhaka
 *  week-boundary math here. */
export function trailingWeekStarts(weeks: number, now: Date = new Date()): string[] {
  const [y, m, d] = salesWeekStartDate(now).split('-').map(Number)
  const baseUtcMs = Date.UTC(y, m - 1, d)
  const out: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    out.push(new Date(baseUtcMs - i * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10))
  }
  return out
}
