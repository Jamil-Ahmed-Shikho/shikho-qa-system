// ============================================================
// SHIKHO QA SYSTEM — Agent-scoped call browsing: query building (§9/§10, Part 2)
// Pure — no server-only imports, no network — so the filter grammar is
// unit-testable without a live CRM call. src/lib/crm/client.ts owns the
// actual fetch (getCallsForAgent) and imports buildAgentCallsQuery from here.
//
// FEASIBILITY CONFIRMED read-only 2026-09-27 (CLAUDE.md §10): `calling-histories`
// filters by agent (`created_by`), call status, duration (`>`), a date range
// (`started_at` with `>`/`<`, DATE-GRANULAR — a plain "YYYY-MM-DD" is read as
// midnight Dhaka of that date, the same convention the daily revenue sync
// uses, §8), lead stage at call time (`lead_stage_id`), and distribution
// list through the lead relation (`lead.last_dist_name`) — all combine with
// `join=and`. A cursor (`id:<N`) is used for paging, never a deep page
// number (§14 — offset pagination degrades badly on this CRM).
// ============================================================

/**
 * Observed values only (CLAUDE.md §10) — NOT confirmed exhaustive by the CRM.
 * A value the CRM might send that isn't here still displays (CallStatusPill
 * falls back to a neutral style for an unrecognised status) — this list is
 * only ever used to populate the FILTER dropdown, never to reject a row.
 */
export const CALL_STATUS_OPTIONS = [
  { value: 'ANSWER', label: 'Answer' },
  { value: 'NOANSWER', label: 'No Answer' },
  { value: 'INITIATING', label: 'Initiating' },
] as const

export type DateRangePreset = 'today' | 'yesterday' | 'current_week' | 'current_month' | 'custom'

export const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'current_week', label: 'Current Sales Week (Sat–Fri)' },
  { value: 'current_month', label: 'Current Month' },
  { value: 'custom', label: 'Specific date range' },
]

/** CONFIRMED defaults by Jamil (2026-09-27): this agent, Current Sales Week, Answer only, duration > 300s (5 min). */
export const DEFAULT_STATUS = 'ANSWER'
export const DEFAULT_RANGE: DateRangePreset = 'current_week'
export const DEFAULT_MIN_DURATION_SECONDS = 300
export const PAGE_SIZE = 25

/** The Dhaka calendar date ("YYYY-MM-DD") for a real instant. Dhaka has no DST, so a fixed +6h shift is exact. */
export function dhakaDateStr(instant: Date): string {
  return new Date(instant.getTime() + 6 * 3600_000).toISOString().slice(0, 10)
}

/** A "YYYY-MM-DD" calendar date, shifted by `days` (may be negative) — pure calendar arithmetic, no time zone involved. */
export function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function monthStartStr(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10)
}

/** The Saturday on/before a Dhaka calendar date — the current sales week's start (§6.3). */
function salesWeekStartStr(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay() // Sun=0 .. Sat=6
  return shiftDateStr(dateStr, -((dow + 1) % 7))
}

/**
 * The Dhaka calendar-date range for a preset: `from` inclusive, `toExclusive` the day AFTER the last day wanted
 * (so `started_at:from;started_at:toExclusive` with `>`/`<` reads as "from midnight Dhaka `from` up to, but not
 * including, midnight Dhaka `toExclusive`" — i.e. through the end of the last included day).
 */
export function dateRangeFor(
  preset: DateRangePreset,
  now: Date = new Date(),
  custom?: { from: string; to: string }
): { from: string; toExclusive: string } {
  const today = dhakaDateStr(now)
  switch (preset) {
    case 'today':
      return { from: today, toExclusive: shiftDateStr(today, 1) }
    case 'yesterday':
      return { from: shiftDateStr(today, -1), toExclusive: today }
    case 'current_week':
      return { from: salesWeekStartStr(today), toExclusive: shiftDateStr(today, 1) }
    case 'current_month':
      return { from: monthStartStr(today), toExclusive: shiftDateStr(today, 1) }
    case 'custom': {
      if (!custom?.from || !custom?.to || custom.from > custom.to) return dateRangeFor('current_week', now)
      return { from: custom.from, toExclusive: shiftDateStr(custom.to, 1) } // the picked "to" date is inclusive
    }
  }
}

export interface AgentCallFilters {
  status: string | null
  minDurationSeconds: number | null
  leadStageId: string | null
  /** Free text, matched via lead.last_dist_name (the CRM has no enumerable list of these — §10). */
  distributionList: string | null
  range: DateRangePreset
  customFrom: string | null
  customTo: string | null
}

export const DEFAULT_FILTERS: AgentCallFilters = {
  status: DEFAULT_STATUS,
  minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
  leadStageId: null,
  distributionList: null,
  range: DEFAULT_RANGE,
  customFrom: null,
  customTo: null,
}

/**
 * The `?search=...&conditions=...&join=and&...` query string for `/calling-histories`, scoped to one CRM agent id
 * and the given filters, newest first, id-cursor paginated (never a deep page number — §14).
 */
export function buildAgentCallsQuery(opts: {
  crmAgentId: number
  filters: AgentCallFilters
  /** Only rows with id STRICTLY LESS than this (the previous page's last row) — omit for the first page. */
  beforeId?: number | null
  limit: number
  now?: Date
}): string {
  const { crmAgentId, filters, beforeId, limit, now = new Date() } = opts
  const search: string[] = [`created_by:${crmAgentId}`]
  const conditions: string[] = ['created_by:=']

  if (filters.status) {
    search.push(`call_status:${filters.status}`)
    conditions.push('call_status:=')
  }
  if (filters.minDurationSeconds !== null && filters.minDurationSeconds > 0) {
    search.push(`duration:${filters.minDurationSeconds}`)
    conditions.push('duration:%3E')
  }
  if (filters.leadStageId) {
    search.push(`lead_stage_id:${filters.leadStageId}`)
    conditions.push('lead_stage_id:=')
  }
  if (filters.distributionList?.trim()) {
    search.push(`lead.last_dist_name:${encodeURIComponent(filters.distributionList.trim())}`)
    conditions.push('lead.last_dist_name:=')
  }
  const { from, toExclusive } = dateRangeFor(filters.range, now, filters.customFrom && filters.customTo ? { from: filters.customFrom, to: filters.customTo } : undefined)
  search.push(`started_at:${from}`)
  conditions.push('started_at:%3E')
  search.push(`started_at:${toExclusive}`)
  conditions.push('started_at:%3C')
  if (beforeId) {
    search.push(`id:${beforeId}`)
    conditions.push('id:%3C')
  }

  return `?search=${search.join(';')}&conditions=${conditions.join(';')}&join=and&page=1&limit=${limit}&orderBy=id&sortedBy=desc`
}
