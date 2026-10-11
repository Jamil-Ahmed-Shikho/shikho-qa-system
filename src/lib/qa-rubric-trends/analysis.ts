// ============================================================
// SHIKHO QA SYSTEM — Rubric Fail Trends: pure analysis helpers (category
// rollup, severity thresholds, small-sample flag, sparkline shaping). No
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

export interface CategoryRollupRow {
  categoryId: string
  categoryName: string
  rubricName: string
  totalScored: number
  totalFailed: number
  failRatePct: number
  priorTotalScored: number
  priorTotalFailed: number
  priorFailRatePct: number | null
  trendPctPoints: number | null
}

/** Rolls the already-filtered/scoped parameter rows up to their rubric category, summing raw counts
 *  (not averaging percentages — a category with one parameter scored 1000 times and another scored
 *  10 times must not weight them equally). Sorted worst fail rate first, same convention as the
 *  parameter table. */
export function buildCategoryRollup(rows: RubricFailTrendRow[]): CategoryRollupRow[] {
  const map = new Map<string, CategoryRollupRow>()
  for (const r of rows) {
    const existing = map.get(r.categoryId)
    if (existing) {
      existing.totalScored += r.totalScored
      existing.totalFailed += r.totalFailed
      existing.priorTotalScored += r.priorTotalScored
      existing.priorTotalFailed += r.priorTotalFailed
    } else {
      map.set(r.categoryId, {
        categoryId: r.categoryId, categoryName: r.categoryName, rubricName: r.rubricName,
        totalScored: r.totalScored, totalFailed: r.totalFailed,
        priorTotalScored: r.priorTotalScored, priorTotalFailed: r.priorTotalFailed,
        failRatePct: 0, priorFailRatePct: null, trendPctPoints: null,
      })
    }
  }
  return [...map.values()]
    .map((c) => {
      const failRatePct = c.totalScored > 0 ? round1((c.totalFailed / c.totalScored) * 100) : 0
      const priorFailRatePct = c.priorTotalScored > 0 ? round1((c.priorTotalFailed / c.priorTotalScored) * 100) : null
      const trendPctPoints = priorFailRatePct !== null ? round1(failRatePct - priorFailRatePct) : null
      return { ...c, failRatePct, priorFailRatePct, trendPctPoints }
    })
    .sort((a, b) => b.failRatePct - a.failRatePct)
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
