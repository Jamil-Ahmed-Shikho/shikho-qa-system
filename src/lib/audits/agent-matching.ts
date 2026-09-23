// ============================================================
// SHIKHO QA SYSTEM — CRM agent matching (§10)
// Resolves a CRM call's `created_by` to one of our users.
//
// A call's `created_by` is only { id, name (a display name), … } — no
// email. The email (the CRM login, which is our users.email — confirmed
// by Jamil) comes from GET /users/{created_by.id}. So matching is:
//   1. users.crm_agent_id = created_by.id   (cached from an earlier match)
//   2. else ask the CRM for that user's email and match users.email,
//      then cache crm_agent_id so later calls skip the CRM lookup.
// Name-matching is deliberately not used — display names collide.
//
// (An earlier version compared created_by.name to users.email. That
// field is a display name, so it never matched anything.)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server'
import { getCrmUser } from '@/lib/crm/client'
import type { CrmCallCreatedBy } from '@/lib/crm/types'
import type { CrmAgentInfo } from './crm-agent'

export interface AgentMatch {
  id: string
  name: string
  email: string
  matchedBy: 'crm_agent_id' | 'email'
}

export interface AgentResolution {
  match: AgentMatch | null
  /** What the CRM reported about this agent — shown to QA when there's no match. */
  crm: CrmAgentInfo
}

interface UserRow {
  id: string
  name: string
  email: string
  team_leader_id: string | null
  crm_agent_id: number | null
}

const USER_COLUMNS = 'id, name, email, team_leader_id, crm_agent_id'

async function crmEmailFor(
  createdBy: CrmCallCreatedBy,
  actorId: string | null
): Promise<{ email: string | null; lookupFailed: boolean }> {
  try {
    const user = await getCrmUser(createdBy.id, actorId)
    return { email: user?.email ?? null, lookupFailed: false }
  } catch (err) {
    // Message only — never the CRM record, which carries personal details.
    console.error('CRM user lookup failed:', err instanceof Error ? err.message : err)
    return { email: null, lookupFailed: true }
  }
}

async function matchUser(
  db: SupabaseClient,
  createdBy: CrmCallCreatedBy,
  actorId: string | null
): Promise<{ user: UserRow | null; via: 'crm_agent_id' | 'email' | null; crm: CrmAgentInfo }> {
  const name = createdBy.name?.trim() || null

  const { data: byCrmId } = await db
    .from('users')
    .select(USER_COLUMNS)
    .eq('crm_agent_id', createdBy.id)
    .maybeSingle()
  if (byCrmId) {
    return { user: byCrmId as UserRow, via: 'crm_agent_id', crm: { name, email: null, lookupFailed: false } }
  }

  const { email, lookupFailed } = await crmEmailFor(createdBy, actorId)
  const crm: CrmAgentInfo = { name, email, lookupFailed }
  if (!email) return { user: null, via: null, crm }

  const { data: byEmail } = await db.from('users').select(USER_COLUMNS).eq('email', email).maybeSingle()
  if (!byEmail) return { user: null, via: null, crm }

  // Remember the mapping so future calls skip the CRM lookup. A narrow,
  // system-computed field — written with the admin client because the
  // users_write_admin RLS policy (schema_001) deliberately limits row
  // edits to super_admin/qa_manager. `is null` keeps a manually-corrected
  // mapping from being overwritten; a clash on the unique column is ignored.
  if ((byEmail as UserRow).crm_agent_id === null) {
    await getSupabaseAdmin()
      .from('users')
      .update({ crm_agent_id: createdBy.id })
      .eq('id', (byEmail as UserRow).id)
      .is('crm_agent_id', null)
  }

  return { user: byEmail as UserRow, via: 'email', crm }
}

/**
 * For the call list's agent dropdown: who took this call, as far as the
 * signed-in user is allowed to see (their session/RLS applies), plus what
 * the CRM said about the agent so QA can act when there's no match.
 * `client` is injectable for tests.
 */
export async function resolveAgentForCall(
  createdBy: CrmCallCreatedBy,
  actorId: string | null,
  client?: SupabaseClient
): Promise<AgentResolution> {
  const db = client ?? ((await getSupabaseServer()) as unknown as SupabaseClient)
  const { user, via, crm } = await matchUser(db, createdBy, actorId)
  return {
    match: user && via ? { id: user.id, name: user.name, email: user.email, matchedBy: via } : null,
    crm,
  }
}

// Who really took this call, ignoring what the signed-in user's RLS lets
// them see. Used to enforce "a Team Lead audits only their own team":
// a Team Lead's session can't read agents outside their team, so the
// session-based resolveAgentForCall would just say "no match" — this
// answers the real question (does this call belong to MY team?). Any
// failure (unknown agent, CRM unreachable) returns null, which the
// callers treat as "not yours" — it fails closed.
export async function findCallOwner(
  createdBy: CrmCallCreatedBy,
  actorId: string | null,
  client?: SupabaseClient
): Promise<{ id: string; team_leader_id: string | null } | null> {
  const db = client ?? (getSupabaseAdmin() as unknown as SupabaseClient)
  const { user } = await matchUser(db, createdBy, actorId)
  return user ? { id: user.id, team_leader_id: user.team_leader_id } : null
}

// Active agents, for the manual-confirm dropdown when auto-match
// fails or needs overriding.
export async function listActiveAgents(): Promise<{ id: string; name: string; email: string }[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('role', 'agent')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}
