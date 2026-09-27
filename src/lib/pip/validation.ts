// ============================================================
// SHIKHO QA SYSTEM — PIP input validation (§6.4)
// Pure. Mirrors the table CHECK constraints in schema_027 so the form can
// say what is wrong in plain words before the database does.
// ============================================================

export interface PolicyInput {
  revenueBenchmark: number
  /** Completed SALES WEEKS of tenure (not calendar days), checked at cycle start — schema_040, Q8. */
  vintageMinWeeks: number
  durationWeeks: number
  targetRevenue: number
  bottomNPerSite: number
  /** Which teams/channels PIP applies to (Q15) — at least one, each a real TEAM_NAMES value. */
  scopedTeams: string[]
}

export const FEEDBACK_MAX = 2000
export const TRAINING_NOTES_MAX = 2000
const KNOWN_TEAMS = new Set(['Telesales', 'CX Non-Voice', 'CX Inbound', 'Engagement', 'Retention', 'TS3P'])

export function validatePolicy(p: PolicyInput): string | null {
  const whole = (n: number) => Number.isInteger(n)
  if (!(p.revenueBenchmark > 0)) return 'The revenue benchmark must be greater than zero.'
  if (!whole(p.vintageMinWeeks) || p.vintageMinWeeks < 0) return 'The minimum vintage must be a whole number of completed sales weeks, 0 or more.'
  if (!whole(p.durationWeeks) || p.durationWeeks < 1 || p.durationWeeks > 12) return 'The duration must be between 1 and 12 whole weeks.'
  if (!(p.targetRevenue >= 0)) return 'The target revenue cannot be negative.'
  if (!whole(p.bottomNPerSite) || p.bottomNPerSite < 1 || p.bottomNPerSite > 100) return 'Bottom N per team/channel must be a whole number between 1 and 100.'
  if (p.scopedTeams.length === 0) return 'Choose at least one team/channel for PIP to apply to.'
  if (p.scopedTeams.some((t) => !KNOWN_TEAMS.has(t))) return 'Unknown team/channel in the PIP scope.'
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

/** A candidate's tenure at selection, in completed sales weeks (Q8) — not calendar days. */
export function describeVintageWeeks(weeks: number | null): string {
  return weeks === null ? '—' : `${weeks} week${weeks === 1 ? '' : 's'}`
}
