// ============================================================
// SHIKHO QA SYSTEM — What the CRM says about a call's agent
// Pure module — safe to import from client components (no server code).
// ============================================================

export interface CrmAgentInfo {
  /** created_by.name — the CRM's display name for the agent, if it gave one. */
  name: string | null
  /** The agent's CRM login email, from GET /users/{id}. null = none on record (or lookup failed). */
  email: string | null
  /** True if we couldn't reach the CRM to look the agent up (so absence of an email means nothing). */
  lookupFailed: boolean
}

export type UnmatchedKind = 'no_profile' | 'lookup_failed' | 'no_email' | 'crm_silent'

/**
 * Words the "no auto-match" state so QA can tell WHY, and what to do:
 *  - no_profile:    the CRM told us exactly who it is (name + email) and we
 *                   have nobody with that email — they need a profile;
 *  - no_email:      the CRM has the person but no email, so we can't match;
 *  - lookup_failed: we couldn't ask the CRM — nothing is known either way;
 *  - crm_silent:    the CRM didn't name anyone at all.
 * `crmSays` is what to show after "CRM says:", or null if it said nothing.
 */
export function describeUnmatched(crm: CrmAgentInfo): { kind: UnmatchedKind; crmSays: string | null; note: string } {
  const name = crm.name?.trim() || null
  const email = crm.email?.trim() || null
  const crmSays = name && email ? `${name} · ${email}` : name ?? email

  if (email) {
    return { kind: 'no_profile', crmSays, note: 'no profile with this email in our system yet' }
  }
  if (crm.lookupFailed && name) {
    return { kind: 'lookup_failed', crmSays, note: "couldn't check the CRM for their email — pick the agent manually" }
  }
  if (name) {
    return { kind: 'no_email', crmSays, note: "the CRM has no email for them, so they can't be matched automatically — pick manually" }
  }
  return { kind: 'crm_silent', crmSays: null, note: "the CRM didn't report which agent took this call — pick manually" }
}
