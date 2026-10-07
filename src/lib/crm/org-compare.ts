// ============================================================
// SHIKHO QA SYSTEM — our org data vs the CRM's reporting line
// Pure module — safe to import from client components.
//
// The CRM keeps agent -> Team Leader -> Manager. We store, per person,
// who the CRM says they report to (schema_010), and compare that with
// OUR assignment (team_leader_id for an agent, manager_id for a Team
// Lead). Nothing here blocks anything — it only reports.
// ============================================================

export interface CrmLink {
  crmId: number | null
  crmName: string | null
  crmEmail: string | null
}

/** Our assigned Team Leader / Manager, as far as comparison needs. */
export interface OurPerson {
  name: string
  email: string
  crm_agent_id: number | null
}

export type LinkStatus =
  | 'in_sync'
  | 'mismatch'         // the CRM names someone else, or someone where we have nobody
  | 'not_checked'      // we have never asked the CRM about this person
  | 'crm_has_none'     // the CRM has no supervisor on record — nothing to compare
  | 'cannot_compare'   // both sides named, but nothing (id/email) lets us tell if they are the same person

export interface LinkComparison {
  status: LinkStatus
  /** Only for 'mismatch': we have nobody set, vs the CRM naming someone else. */
  weHaveNone: boolean
  crmName: string | null
  ourName: string | null
}

/** The stored CRM view of a users row, or null if it has never been checked. */
export function linkOf(row: {
  crm_org_checked_at: string | null
  crm_reporting_to_id: number | null
  crm_reporting_to_name: string | null
  crm_reporting_to_email: string | null
}): CrmLink | null {
  if (!row.crm_org_checked_at) return null
  return { crmId: row.crm_reporting_to_id, crmName: row.crm_reporting_to_name, crmEmail: row.crm_reporting_to_email }
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function samePerson(ours: OurPerson, crm: CrmLink): boolean | null {
  // A cached CRM id is the strongest identity — authoritative either way,
  // never second-guessed by email or name below.
  if (ours.crm_agent_id != null && crm.crmId != null) return ours.crm_agent_id === crm.crmId

  // Next: login email — but ONLY as a positive signal. A Team Lead/Manager
  // almost never gets a crm_agent_id resolved at all (that only happens
  // through an AGENT's own calls/revenue being matched, §8/§10 — confirmed
  // live 2026-10-07: just 4 of 19 active Team Leads/Managers had one), so
  // for a supervisor this email check is usually the only thing available —
  // and the CRM's own stored "reporting_to" email for them is frequently
  // NOT their @shikho.com login here at all, but a personal/gmail address
  // or an @shikho.tech alias. An email MATCH is still trusted; an email
  // DIFFERENCE alone is not treated as proof of a real mismatch — the name
  // gets the final say (below), rather than assuming "different email" means
  // "different person."
  if (crm.crmEmail && ours.email.trim().toLowerCase() === crm.crmEmail.trim().toLowerCase()) return true

  // Fall back to the display name, case/whitespace-insensitive. Verified
  // against live data (2026-10-07): of 164 flagged "mismatches" app-wide,
  // 161 had an IDENTICAL supervisor name on both sides — pure false
  // positives from the email-identity gap above, not a real org problem.
  // Only 3 had a genuinely different name, which this still correctly flags.
  if (crm.crmName) return normalizeName(ours.name) === normalizeName(crm.crmName)

  if (crm.crmEmail) return false // crm has an email (didn't match) and no name to fall back on
  return null // nothing to go on
}

/** A user's comparison, labelled for the Users screen. */
export interface OrgSyncInfo extends LinkComparison {
  /** What is being compared: an agent's Team Leader, or a Team Lead's Manager. */
  label: 'Team Leader' | 'Manager'
  checkedAt: string | null
}

/**
 * For the Users screen: every active agent (vs their Team Leader) and
 * Team Lead (vs their Manager) that has been checked against the CRM.
 * Computed from the stored CRM view and OUR CURRENT assignment, so fixing
 * someone in Users clears their flag immediately. Never-checked users are
 * left out (there is nothing to say about them).
 */
export function orgSyncByUser(
  users: (OurPerson & {
    id: string
    role: string
    is_active: boolean
    team_leader_id: string | null
    manager_id: string | null
    crm_org_checked_at: string | null
    crm_reporting_to_id: number | null
    crm_reporting_to_name: string | null
    crm_reporting_to_email: string | null
  })[]
): Map<string, OrgSyncInfo> {
  const byId = new Map(users.map((u) => [u.id, u]))
  const out = new Map<string, OrgSyncInfo>()
  for (const u of users) {
    if (!u.is_active) continue
    let ourId: string | null
    let label: OrgSyncInfo['label']
    if (u.role === 'agent') { ourId = u.team_leader_id; label = 'Team Leader' }
    else if (u.role === 'team_lead') { ourId = u.manager_id; label = 'Manager' }
    else continue

    const ours = ourId ? byId.get(ourId) ?? null : null
    const cmp = compareLink({ ours, crm: linkOf(u) })
    if (cmp.status === 'not_checked') continue
    out.set(u.id, { ...cmp, label, checkedAt: u.crm_org_checked_at })
  }
  return out
}

export function compareLink(input: { ours: OurPerson | null; crm: CrmLink | null }): LinkComparison {
  const { ours, crm } = input
  const base = { weHaveNone: false, crmName: crm?.crmName ?? crm?.crmEmail ?? null, ourName: ours?.name ?? null }

  if (!crm) return { ...base, status: 'not_checked' }
  if (crm.crmId == null) return { ...base, status: 'crm_has_none' }
  if (!ours) return { ...base, status: 'mismatch', weHaveNone: true }

  const same = samePerson(ours, crm)
  if (same === true) return { ...base, status: 'in_sync' }
  if (same === false) return { ...base, status: 'mismatch' }
  return { ...base, status: 'cannot_compare' }
}
