// ============================================================
// Agent vintage, as plain facts (§6.1).
// The full slab table (vintage_slabs: 1st Month, 1-3 Months, …) is Step 7
// and its day boundaries were never specified, so nothing here invents
// them. What the design DOES confirm: an agent in OJT / re-training is
// "OJT" (a direct read of employment_stage, no day count), and the
// original reports used a coarse "<90 days / >=90 days" split. This shows
// exactly that, plus the raw days and joining date so nothing is hidden.
// ============================================================

export interface Vintage {
  /** Short label, e.g. "OJT", "Under 90 days", "90 days or more", "Not available". */
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

export function agentVintage(
  agent: { employment_stage: string; joining_date: string | null },
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
  return {
    label: days < 90 ? 'Under 90 days' : '90 days or more',
    detail: `${days} day${days === 1 ? '' : 's'} · joined ${joinedFmt.format(new Date(joined))}`,
    days,
  }
}
