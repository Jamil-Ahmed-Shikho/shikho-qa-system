// ============================================================
// Agent vintage (§6.1) — computed, never stored.
// An agent in OJT / re-training is "OJT" (a direct read of employment_stage,
// no day count); anyone else is placed by whole Dhaka calendar days since
// joining against the current vintage_slabs. `vintage_slab_for()` in
// schema_025 is the same rule in the database (a randomized parity test
// keeps the two identical — change one, change the other).
//
// DEFAULT_VINTAGE_SLABS mirrors the seed in schema_025 and is used when the
// table can't be read (before the migration is applied). The day boundaries
// are the ones Jamil confirmed (2026-09-25): 0-30, 31-90, 91-180, 181-270,
// 271-365, then 366+ ("365+" as he wrote it would overlap 9-12 Months).
// ============================================================

export interface VintageSlab {
  label: string
  /** Inclusive. null only for the 'OJT' slab. */
  minDays: number | null
  /** Inclusive; null = open-ended. */
  maxDays: number | null
}

export const DEFAULT_VINTAGE_SLABS: VintageSlab[] = [
  { label: 'OJT', minDays: null, maxDays: null },
  { label: '1st Month', minDays: 0, maxDays: 30 },
  { label: '1-3 Months', minDays: 31, maxDays: 90 },
  { label: '3-6 Months', minDays: 91, maxDays: 180 },
  { label: '6-9 Months', minDays: 181, maxDays: 270 },
  { label: '9-12 Months', minDays: 271, maxDays: 365 },
  { label: '1 Year Plus', minDays: 366, maxDays: null },
]

export interface Vintage {
  /** The slab, e.g. "OJT", "3-6 Months", or "Not available". */
  label: string
  /** The facts behind it, e.g. "254 days · joined 12 Jan 2026". */
  detail: string | null
  /** Whole Dhaka calendar days since joining; null when not applicable. */
  days: number | null
}

const joinedFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function dhakaToday(now: Date): number {
  // Calendar date in Dhaka, as a UTC-midnight timestamp (no DST in Bangladesh).
  const shifted = new Date(now.getTime() + 6 * 60 * 60 * 1000)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

/** The slab a tenure of `days` falls in, or null if none matches (a gap in the slab set). */
export function slabForDays(days: number, slabs: VintageSlab[]): VintageSlab | null {
  const dayed = slabs.filter((s) => s.minDays !== null && s.minDays <= days && (s.maxDays === null || days <= s.maxDays))
  // Same tie-break as the SQL: the slab with the highest start wins.
  dayed.sort((a, b) => (b.minDays as number) - (a.minDays as number))
  return dayed[0] ?? null
}

export function agentVintage(
  agent: { employment_stage: string; joining_date: string | null },
  slabs: VintageSlab[] = DEFAULT_VINTAGE_SLABS,
  now: Date = new Date()
): Vintage {
  if (agent.employment_stage === 'ojt' || agent.employment_stage === 're_training') {
    return { label: 'OJT', detail: agent.employment_stage === 're_training' ? 'In re-training' : 'In on-job training', days: null }
  }
  if (!agent.joining_date) {
    return { label: 'Not available', detail: 'No joining date on record', days: null }
  }
  const [y, m, d] = agent.joining_date.slice(0, 10).split('-').map(Number)
  const joined = Date.UTC(y, m - 1, d)
  if (!Number.isFinite(joined)) return { label: 'Not available', detail: 'Joining date could not be read', days: null }
  const days = Math.round((dhakaToday(now) - joined) / 86_400_000)
  if (days < 0) return { label: 'Not available', detail: 'Joining date is in the future', days: null }
  const slab = slabForDays(days, slabs)
  return {
    label: slab?.label ?? 'Not available',
    detail: `${days} day${days === 1 ? '' : 's'} · joined ${joinedFmt.format(new Date(joined))}`,
    days,
  }
}
