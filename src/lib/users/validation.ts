// ============================================================
// SHIKHO QA SYSTEM — User input validation (§2, §7)
// Pure module — shared by the create/edit form (client) and the
// server actions + Excel bulk import, so both enforce the same rules.
// ============================================================

import { TEAM_NAMES } from '@/types/database.types'
import type { EmploymentStage, UserRole } from '@/types/database.types'
import { EMPLOYMENT_STAGES, SITE_NAMES, USER_ROLES } from './constants'

export interface UserInput {
  name: string
  email: string
  emp_id: string
  role: string
  team_name: string
  site_name: string
  joining_date: string
  employment_stage: string
  ojt_start_date: string
}

export interface NormalizedUserInput {
  name: string
  email: string
  emp_id: string | null
  role: UserRole
  team_name: string | null
  site_name: string | null
  joining_date: string | null
  employment_stage: EmploymentStage
  ojt_start_date: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// Accept either the stored value ("qa_auditor") or the display label
// ("QA Auditor"), case-insensitive — the Excel template shows labels.
function matchOption<T extends string>(
  raw: string,
  options: { value: T; label: string }[]
): T | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_')
  const target = norm(raw)
  const hit = options.find((o) => norm(o.value) === target || norm(o.label) === target)
  return hit ? hit.value : null
}

// Every agent reports to a Team Leader — there is no case where an agent
// reports straight to a Manager, so a missing Team Leader is a
// data-entry error to reject, not a state to support. Mirrors the
// database check (users_agent_requires_team_leader, schema_008).
export function validateTeamLeaderRequired(role: UserRole, teamLeaderId: string | null | undefined): string | null {
  if (role === 'agent' && !teamLeaderId) {
    return 'Every agent must have a Team Leader — select one.'
  }
  return null
}

export function validateUserInput(
  raw: UserInput
): { ok: true; value: NormalizedUserInput } | { ok: false; error: string } {
  const name = raw.name.trim()
  const email = raw.email.trim().toLowerCase()
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!email) return { ok: false, error: 'Email is required.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: `"${raw.email.trim()}" is not a valid email address.` }

  const role = matchOption(raw.role, USER_ROLES)
  if (!role) return { ok: false, error: `Unknown role "${raw.role}". Use one of: ${USER_ROLES.map((r) => r.label).join(', ')}.` }

  const stage = raw.employment_stage.trim()
    ? matchOption(raw.employment_stage, EMPLOYMENT_STAGES)
    : 'active'
  if (!stage) {
    return { ok: false, error: `Unknown employment stage "${raw.employment_stage}". Use one of: ${EMPLOYMENT_STAGES.map((s) => s.label).join(', ')}.` }
  }

  const teamRaw = raw.team_name.trim()
  let team: string | null = null
  if (teamRaw) {
    team = TEAM_NAMES.find((t) => t.toLowerCase() === teamRaw.toLowerCase()) ?? null
    if (!team) return { ok: false, error: `Unknown team "${teamRaw}". Use one of: ${TEAM_NAMES.join(', ')}.` }
  }

  const siteRaw = raw.site_name.trim()
  let site: string | null = null
  if (siteRaw) {
    site = SITE_NAMES.find((s) => s.toLowerCase() === siteRaw.toLowerCase()) ?? null
    if (!site) return { ok: false, error: `Unknown site "${siteRaw}". Use one of: ${SITE_NAMES.join(', ')}.` }
  }

  // Agents are matched to a rubric via their team (Step 2/3) and sliced
  // by site in reports/PIP (§6.4), so both are required for them.
  // Team leads audit "own team", so they need a team too.
  if ((role === 'agent' || role === 'team_lead') && !team) {
    return { ok: false, error: 'Team is required for agents and team leads.' }
  }
  if (role === 'agent' && !site) {
    return { ok: false, error: 'Site is required for agents.' }
  }

  const joining = raw.joining_date.trim()
  const ojtStart = raw.ojt_start_date.trim()
  if (joining && !isValidIsoDate(joining)) return { ok: false, error: `Joining date "${joining}" must be a valid date in yyyy-mm-dd format.` }
  if (ojtStart && !isValidIsoDate(ojtStart)) return { ok: false, error: `OJT start date "${ojtStart}" must be a valid date in yyyy-mm-dd format.` }

  // §7: joining_date stays null until OJT is certified.
  if ((stage === 'ojt' || stage === 're_training') && joining) {
    return { ok: false, error: 'Joining date must be empty while in OJT / re-training — it is set when the agent is certified.' }
  }
  // Vintage (§6.1) is computed from joining_date, so an active agent needs one.
  if (role === 'agent' && stage === 'active' && !joining) {
    return { ok: false, error: 'Joining date is required for active agents (used to compute vintage).' }
  }

  return {
    ok: true,
    value: {
      name,
      email,
      emp_id: raw.emp_id.trim() || null,
      role,
      team_name: team,
      site_name: site,
      joining_date: joining || null,
      employment_stage: stage,
      ojt_start_date: ojtStart || null,
    },
  }
}
