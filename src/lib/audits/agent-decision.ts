// ============================================================
// SHIKHO QA SYSTEM — Which agent does a new audit attach to?
// Pure module. Decides, on the server, from the call's REAL owner (as
// resolved from the CRM) — never from what the browser claims.
// ============================================================

import type { UserRole } from '@/types/database.types'

export type AgentDecision = { ok: true; agentId: string; source: 'crm_match' | 'manual' } | { ok: false; error: string }

/**
 * - If the CRM identifies the call's agent and we have their profile
 *   (`owner`), the audit is attached to THAT person. Whatever agent the
 *   browser sent is ignored: a matched call is trusted fully and can't be
 *   re-pointed at someone else.
 * - Only when there is no match does the auditor's manual pick count.
 * - A Team Lead may only audit a call owned by one of their own agents;
 *   an unknown owner can't be shown to be theirs, so it is refused.
 */
export function decideAuditAgent(input: {
  viewerRole: UserRole
  viewerId: string
  owner: { id: string; team_leader_id: string | null } | null
  clientAgentId: string | null | undefined
}): AgentDecision {
  const { viewerRole, viewerId, owner, clientAgentId } = input

  if (viewerRole === 'team_lead' && (!owner || owner.team_leader_id !== viewerId)) {
    return { ok: false, error: 'You can only audit calls taken by agents on your own team.' }
  }
  if (owner) return { ok: true, agentId: owner.id, source: 'crm_match' }
  if (!clientAgentId) return { ok: false, error: 'Select the agent this call belongs to.' }
  return { ok: true, agentId: clientAgentId, source: 'manual' }
}
