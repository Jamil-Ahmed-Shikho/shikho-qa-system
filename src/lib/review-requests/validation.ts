// ============================================================
// SHIKHO QA SYSTEM — Review Request input validation (§4, Section D, Part 1)
// Pure. Mirrors the CHECK constraints / function rules in schema_048 so a
// form can say what is wrong in plain words before the database does.
//
// Client-safe on purpose: client components (the forms) import labels and
// types from HERE, never from review-requests.service.ts, which is
// server-only (it reads cookies) and would break the build if a client
// file pulled it in (§14's DisputeForms lesson, applied here too).
// ============================================================

export const REASON_MAX = 2000
export const NOTE_MAX = 2000

export type ReviewRequestStatus = 'with_team_lead' | 'with_qa_manager' | 'resolved'
export type TeamLeadDecision = 'upheld' | 'escalated'
export type FinalOutcome = 'no_change' | 'revised'
export type FilerRole = 'agent' | 'team_lead' | 'manager'

export const STATUS_LABEL: Record<ReviewRequestStatus, string> = {
  with_team_lead: 'With Team Lead',
  with_qa_manager: 'With QA Manager',
  resolved: 'Resolved',
}
export const FINAL_OUTCOME_LABEL: Record<FinalOutcome, string> = {
  no_change: 'No change',
  revised: 'Revised',
}

export function validateReason(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Explain what you are requesting a review of.'
  if (text.length > REASON_MAX) return `The reason can be at most ${REASON_MAX} characters.`
  return null
}

export function validateNote(text: string): string | null {
  const t = text.trim()
  if (!t) return 'A note is required.'
  if (text.length > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`
  return null
}

/**
 * How a Review Request's origin is worded — the same words everywhere it is shown, so one filed
 * by a Team Lead or Manager can never read as the agent's own (mirrors the old Disputes wording).
 */
export function filedByLine(r: { filerRole: FilerRole; raisedByName: string | null; agentName: string | null }, viewerIsAgent = false): string {
  if (r.filerRole === 'agent') return viewerIsAgent ? 'Filed by you' : `Filed by ${r.raisedByName ?? r.agentName ?? 'the agent'}`
  const who = r.filerRole === 'team_lead' ? 'Team Lead' : 'Manager'
  return viewerIsAgent
    ? `Filed by your ${who}${r.raisedByName ? ` ${r.raisedByName}` : ''} on your behalf`
    : `Filed by ${r.raisedByName ? `${who} ${r.raisedByName}` : `a ${who}`} on behalf of ${r.agentName ?? 'the agent'}`
}
