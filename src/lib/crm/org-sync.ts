// ============================================================
// SHIKHO QA SYSTEM — opportunistic org-data check against the CRM
// Server-only.
//
// When a MATCHED agent comes up on the call list we compare, at two
// levels, our org data with the CRM's reporting line:
//     agent        -> Team Leader   (our team_leader_id)
//     Team Leader  -> Manager       (our manager_id)
// What the CRM says is remembered on the user row (schema_010) and only
// re-asked when it is more than 24h old, so this adds a handful of CRM
// lookups per agent per day at most — there is no scheduled sweep.
//
// Purely informational: it returns notes to display and never blocks or
// changes an audit. Any failure (CRM down…) yields no notes — never an error.
// ============================================================

import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { getCrmUser } from './client'
import { compareLink, linkOf, type OurPerson } from './org-compare'

export const ORG_CHECK_TTL_MS = 24 * 60 * 60 * 1000

export interface OrgNote {
  level: 'team_leader' | 'manager'
  /** The person the note is about: the agent (team_leader level) or the Team Leader (manager level). */
  subject: string
  /** For the manager level, the agent whose Team Leader this is (for context). */
  onBehalfOf?: string
  crmName: string | null
  ourName: string | null
  weHaveNone: boolean
}

interface OrgRow {
  id: string
  name: string
  email: string
  team_leader_id: string | null
  manager_id: string | null
  crm_agent_id: number | null
  crm_reporting_to_id: number | null
  crm_reporting_to_name: string | null
  crm_reporting_to_email: string | null
  crm_org_checked_at: string | null
}

const COLUMNS =
  'id, name, email, team_leader_id, manager_id, crm_agent_id, crm_reporting_to_id, crm_reporting_to_name, crm_reporting_to_email, crm_org_checked_at'

async function getRow(db: SupabaseClient, id: string): Promise<OrgRow | null> {
  const { data } = await db.from('users').select(COLUMNS).eq('id', id).maybeSingle()
  return (data as OrgRow | null) ?? null
}

const person = (r: OrgRow | null): OurPerson | null =>
  r ? { name: r.name, email: r.email, crm_agent_id: r.crm_agent_id } : null

function isStale(row: OrgRow, now: Date): boolean {
  if (!row.crm_org_checked_at) return true
  return now.getTime() - new Date(row.crm_org_checked_at).getTime() > ORG_CHECK_TTL_MS
}

// Ask the CRM who `crmUserId` reports to, and who that person is (email),
// and remember it on `row`. Two lookups. If either fails, nothing is
// written — the stored value stays as it was and we try again next time.
async function refreshLink(
  db: SupabaseClient,
  row: OrgRow,
  crmUserId: number,
  actorId: string | null,
  now: Date
): Promise<void> {
  try {
    const crmUser = await getCrmUser(crmUserId, actorId)
    let link: { id: number | null; name: string | null; email: string | null } = { id: null, name: null, email: null }

    if (crmUser?.reporting_to) {
      const target = await getCrmUser(crmUser.reporting_to.id, actorId)
      link = {
        id: crmUser.reporting_to.id,
        name: target?.name ?? crmUser.reporting_to.name,
        email: target?.email ?? null,
      }
    }

    await db
      .from('users')
      .update({
        crm_reporting_to_id: link.id,
        crm_reporting_to_name: link.name,
        crm_reporting_to_email: link.email,
        crm_org_checked_at: now.toISOString(),
      })
      .eq('id', row.id)
  } catch (err) {
    console.error('CRM org check failed:', err instanceof Error ? err.message : err)
  }
}

// Remember someone's CRM id once we're sure who they are (a clash on the
// unique column is ignored; `is null` never overwrites a manual mapping).
async function rememberCrmId(db: SupabaseClient, userId: string, crmId: number): Promise<void> {
  await db.from('users').update({ crm_agent_id: crmId }).eq('id', userId).is('crm_agent_id', null)
}

/** Exported (with an injectable client and clock) for tests; the app uses checkOrgSync. */
export async function runOrgSync(
  db: SupabaseClient,
  agentUserId: string,
  agentCrmId: number,
  actorId: string | null,
  now: Date = new Date()
): Promise<OrgNote[]> {
  try {
    const agent0 = await getRow(db, agentUserId)
    if (!agent0) return []

    // ── level 1: agent -> Team Leader ────────────────────────
    if (isStale(agent0, now)) await refreshLink(db, agent0, agent0.crm_agent_id ?? agentCrmId, actorId, now)
    const agent = (await getRow(db, agentUserId)) ?? agent0
    const ourTl = agent.team_leader_id ? await getRow(db, agent.team_leader_id) : null

    const notes: OrgNote[] = []
    const agentLink = linkOf(agent)
    const cmp1 = compareLink({ ours: person(ourTl), crm: agentLink })
    if (cmp1.status === 'mismatch') {
      notes.push({ level: 'team_leader', subject: agent.name, crmName: cmp1.crmName, ourName: cmp1.ourName, weHaveNone: cmp1.weHaveNone })
    }

    // If the CRM's Team Leader is provably OUR Team Leader, we now know
    // their CRM id — remember it (it also lets level 2 run).
    let tlCrmId = ourTl?.crm_agent_id ?? null
    if (ourTl && cmp1.status === 'in_sync' && agentLink?.crmId != null && tlCrmId == null) {
      await rememberCrmId(db, ourTl.id, agentLink.crmId)
      tlCrmId = agentLink.crmId
    }

    // ── level 2: Team Leader -> Manager ──────────────────────
    // Only for OUR Team Leader, and only when we know their CRM id —
    // otherwise we'd be asking about the wrong person.
    if (ourTl && tlCrmId != null) {
      if (isStale(ourTl, now)) await refreshLink(db, ourTl, tlCrmId, actorId, now)
      const tl = (await getRow(db, ourTl.id)) ?? ourTl
      const ourManager = tl.manager_id ? await getRow(db, tl.manager_id) : null
      const cmp2 = compareLink({ ours: person(ourManager), crm: linkOf(tl) })
      if (cmp2.status === 'mismatch') {
        notes.push({
          level: 'manager',
          subject: tl.name,
          onBehalfOf: agent.name,
          crmName: cmp2.crmName,
          ourName: cmp2.ourName,
          weHaveNone: cmp2.weHaveNone,
        })
      }
    }
    return notes
  } catch (err) {
    console.error('Org sync check failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * For the call list. `cache` collapses the several calls one agent has on
 * a lead into a single check per page render. Uses the service-role
 * client because it writes the system-computed CRM columns, and needs to
 * read the agent's Team Leader / Manager whichever of them the viewer's
 * own RLS would let them see (a Team Lead can't read their Manager).
 */
export const checkOrgSync = cache(
  async (agentUserId: string, agentCrmId: number, actorId: string | null): Promise<OrgNote[]> =>
    runOrgSync(getSupabaseAdmin() as unknown as SupabaseClient, agentUserId, agentCrmId, actorId)
)
