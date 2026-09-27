// ============================================================
// SHIKHO QA SYSTEM — Calibration sessions: input rules (§5, Stage 1)
// Client-safe (no server imports). The database (schema_031) enforces the
// same rules; this gives instant, plain-language feedback in the form.
// ============================================================

export type CalibrationKind = 'team' | 'qa_only'
export type ItemType = 'call' | 'chat' | 'complaint'

export const KIND_LABELS: Record<CalibrationKind, string> = {
  team: 'Team session (QA + Team Leads)',
  qa_only: 'QA-only (with QA teammates)',
}

export const TITLE_MAX = 100
export const MAX_PARTICIPANTS = 30

export interface Candidate {
  id: string
  name: string
  role: string
  teamName: string | null
  siteName: string | null
}

const QA_ROLES = ['qa_auditor', 'qa_manager', 'super_admin']

/** Same rule as calibration_invite_problem() in schema_031. null = may be invited. */
export function inviteProblem(c: Candidate, kind: CalibrationKind, team: string, site: string): string | null {
  if (QA_ROLES.includes(c.role)) return null
  if (c.role === 'team_lead') {
    if (kind !== 'team') return `${c.name} is a Team Lead — a QA-only session can include QA staff only.`
    if (c.teamName !== team || c.siteName !== site) return `${c.name} is not a Team Lead of ${team} · ${site}.`
    return null
  }
  return `${c.name} cannot be a calibration participant.`
}

/** Who may appear in the picker for this scope. */
export function eligibleCandidates(all: Candidate[], kind: CalibrationKind, team: string, site: string): Candidate[] {
  return all.filter((c) => inviteProblem(c, kind, team, site) === null)
}

/**
 * Parse a datetime-local value ("YYYY-MM-DDTHH:mm", no zone) as DHAKA local time
 * (staff schedule in Bangladesh time; the server runs in UTC). Returns an ISO instant or null.
 */
export function parseDhakaLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(`${value}:00+06:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** An ISO instant as a datetime-local value in Dhaka time. */
export function toDhakaLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 16)
}

export interface SessionInput {
  kind: CalibrationKind
  title: string
  itemType: ItemType
  itemReference: string
  leadId: string
  callId: string
  rubricId: string
  teamName: string
  siteName: string
  scheduledLocal: string
  participantIds: string[]
}

/** Returns a plain-language problem, or null. `all` = the people the picker offered. */
export function validateSession(input: SessionInput, all: Candidate[], now: Date = new Date()): string | null {
  if (input.title.length > TITLE_MAX) return `The title can be at most ${TITLE_MAX} characters.`
  if (!input.teamName || !input.siteName) return 'Choose the team/channel and the site this session is for.'
  if (input.itemType === 'call') {
    if (!input.callId.trim() || !input.leadId.trim()) return 'Choose the call to calibrate on (from a lead’s call list).'
  } else if (!input.itemReference.trim()) {
    return 'Enter the chat link or complaint ID.'
  }
  if (!input.rubricId) return 'Choose a rubric.'
  const iso = parseDhakaLocal(input.scheduledLocal)
  if (!iso) return 'Choose a date and time.'
  if (new Date(iso).getTime() < now.getTime() - 5 * 60_000) return 'The date and time cannot be in the past.'
  const byId = new Map(all.map((c) => [c.id, c]))
  const picked = [...new Set(input.participantIds)]
  for (const id of picked) {
    const c = byId.get(id)
    if (!c) return 'Someone chosen is not available to invite.'
    const p = inviteProblem(c, input.kind, input.teamName, input.siteName)
    if (p) return p
  }
  if (picked.length > MAX_PARTICIPANTS - 1) return `At most ${MAX_PARTICIPANTS} people can take part.`
  // The scheduler is added automatically, so one other person makes two.
  if (picked.length < 1) return 'Invite at least one other person.'
  return null
}
