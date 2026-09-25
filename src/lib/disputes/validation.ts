// ============================================================
// SHIKHO QA SYSTEM — Dispute input validation (§4, Step 5)
// Pure. Mirrors the CHECK constraints / function rules in schema_028 so a
// form can say what is wrong in plain words before the database does.
// ============================================================

// Client-safe on purpose: client components (the forms) import the labels and types from HERE, never from
// disputes.service.ts, which is server-only (it reads cookies) and would break the build if a client file pulled it in.
export const DISPUTE_TEXT_MAX = 2000
export const OUTCOMES = ['upheld', 'partially_upheld', 'not_upheld'] as const
export type Outcome = (typeof OUTCOMES)[number]
export type DisputeOutcome = Outcome
export type DisputeStatus = 'open' | 'under_review' | 'resolved'

export const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  upheld: 'Upheld',
  partially_upheld: 'Partially upheld',
  not_upheld: 'Not upheld',
}
export const STATUS_LABEL: Record<DisputeStatus, string> = { open: 'Open', under_review: 'Under review', resolved: 'Resolved' }

export function validateDisputeReason(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Explain what you are disputing.'
  if (text.length > DISPUTE_TEXT_MAX) return `The reason can be at most ${DISPUTE_TEXT_MAX} characters.`
  return null
}

export function validateResolution(outcome: string | null, note: string): string | null {
  if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) return 'Choose an outcome: upheld, partially upheld or not upheld.'
  if (!note.trim()) return 'A resolution note is required.'
  if (note.length > DISPUTE_TEXT_MAX) return `The resolution note can be at most ${DISPUTE_TEXT_MAX} characters.`
  return null
}

/**
 * How a dispute's origin is worded — the same words everywhere it is shown, so a dispute filed by a
 * Team Lead can never read as the agent's own.
 */
export function filedByLine(d: { filedOnBehalf: boolean; raisedByName: string | null; agentName: string | null }, viewerIsAgent = false): string {
  if (!d.filedOnBehalf) return viewerIsAgent ? 'Filed by you' : `Filed by ${d.raisedByName ?? d.agentName ?? 'the agent'}`
  return viewerIsAgent
    ? `Filed by your Team Lead${d.raisedByName ? ` ${d.raisedByName}` : ''} on your behalf`
    : `Filed by ${d.raisedByName ? `Team Lead ${d.raisedByName}` : 'a Team Lead'} on behalf of ${d.agentName ?? 'the agent'}`
}
