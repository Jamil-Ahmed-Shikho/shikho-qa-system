// ============================================================
// SHIKHO QA SYSTEM — PIP input validation (§6.4)
// Pure. Mirrors the table CHECK constraints in schema_027 so the form can
// say what is wrong in plain words before the database does.
// ============================================================

export interface PolicyInput {
  revenueBenchmark: number
  vintageMinDays: number
  durationWeeks: number
  targetRevenue: number
  bottomNPerSite: number
  revenueWindowWeeks: number | null
  revenueUnit: 'BDT' | 'USD' | null
}

export const FEEDBACK_MAX = 2000
export const TRAINING_NOTES_MAX = 2000

export function validatePolicy(p: PolicyInput): string | null {
  const whole = (n: number) => Number.isInteger(n)
  if (!(p.revenueBenchmark > 0)) return 'The revenue benchmark must be greater than zero.'
  if (!whole(p.vintageMinDays) || p.vintageMinDays < 0) return 'The minimum vintage must be a whole number of days, 0 or more.'
  if (!whole(p.durationWeeks) || p.durationWeeks < 1 || p.durationWeeks > 12) return 'The duration must be between 1 and 12 whole weeks.'
  if (!(p.targetRevenue >= 0)) return 'The target revenue cannot be negative.'
  if (!whole(p.bottomNPerSite) || p.bottomNPerSite < 1 || p.bottomNPerSite > 100) return 'Bottom N per site must be a whole number between 1 and 100.'
  if ((p.revenueWindowWeeks === null) !== (p.revenueUnit === null)) return 'Set both the revenue window and the unit, or leave both empty.'
  if (p.revenueWindowWeeks !== null && (!whole(p.revenueWindowWeeks) || p.revenueWindowWeeks < 1 || p.revenueWindowWeeks > 26)) {
    return 'The revenue window must be between 1 and 26 whole weeks.'
  }
  return null
}

export function validateFeedback(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Write some feedback first.'
  if (text.length > FEEDBACK_MAX) return `Feedback can be at most ${FEEDBACK_MAX} characters.`
  return null
}

export function validateExclusionReason(text: string): string | null {
  return text.trim() ? null : 'A reason is required to exclude a candidate.'
}

export function validateTraining(sessionNumber: number, whenIso: string): string | null {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) return 'The session number must be a whole number, 1 or more (1 = the pre-PIP session).'
  if (!whenIso || Number.isNaN(new Date(whenIso).getTime())) return 'Pick the session date and time.'
  return null
}

/** Whole days of a candidate's vintage, as words. */
export function describeVintageDays(days: number | null): string {
  return days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`
}
