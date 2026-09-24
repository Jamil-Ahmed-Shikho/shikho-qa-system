import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCallsForLead, CrmApiError } from '@/lib/crm/client'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getCallStatusMap } from '@/lib/audits/audits.service'
import { resolveAgentForCall, listActiveAgents, findCallOwner, type AgentResolution } from '@/lib/audits/agent-matching'
import { checkOrgSync, type OrgNote } from '@/lib/crm/org-sync'
import { CallList, type CallRow } from '@/components/audits/CallList'
import { OrgSyncBanner } from '@/components/audits/OrgSyncBanner'

export default async function LeadCallsPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  // Looked up first: the CRM request is logged against this person.
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')

  // The agent list doesn't depend on the CRM, so it loads WHILE the CRM call
  // is in flight instead of after it. (The no-op catch only stops an
  // unhandled-rejection warning on the early-return paths below; the real
  // await further down still surfaces a genuine failure.)
  const agentsPromise = listActiveAgents()
  agentsPromise.catch(() => {})

  let calls
  try {
    calls = await getCallsForLead(Number(leadId), viewer.profile.id)
  } catch (err) {
    const message = err instanceof CrmApiError ? err.message : 'Could not reach the CRM.'
    return (
      <div>
        <BackLink />
        <ErrorState message={message} />
      </div>
    )
  }

  if (calls.length === 0) {
    return (
      <div>
        <BackLink />
        <EmptyState leadId={leadId} />
      </div>
    )
  }

  const [statusMap, agentOptions] = await Promise.all([getCallStatusMap(calls.map((c) => String(c.id))), agentsPromise])

  // A lead's calls are usually taken by a handful of agents, so look each
  // DISTINCT agent up once and share the answer — not once per call (13
  // calls by 2 agents used to mean 13 matching lookups).
  const resolutions = new Map<number, Promise<AgentResolution>>()
  const owners = new Map<number, ReturnType<typeof findCallOwner>>()
  const resolveOnce = (createdBy: (typeof calls)[number]['created_by']) => {
    if (!resolutions.has(createdBy.id)) resolutions.set(createdBy.id, resolveAgentForCall(createdBy, viewer.profile.id))
    return resolutions.get(createdBy.id)!
  }
  const ownerOnce = (createdBy: (typeof calls)[number]['created_by']) => {
    if (!owners.has(createdBy.id)) owners.set(createdBy.id, findCallOwner(createdBy, viewer.profile.id))
    return owners.get(createdBy.id)!
  }

  const isTeamLead = viewer.role === 'team_lead'
  const rows: CallRow[] = await Promise.all(
    calls.map(async (call) => {
      const status = statusMap.get(String(call.id)) ?? null
      const { match: matchedAgent, crm: crmAgent } = await resolveOnce(call.created_by)
      // A Team Lead audits only their own team's calls. Unknown owners
      // count as "not yours" — the call can't be shown to be theirs.
      let outsideTeam: boolean | undefined
      if (isTeamLead) {
        const owner = await ownerOnce(call.created_by)
        outsideTeam = !owner || owner.team_leader_id !== viewer.profile.id
      }
      return { call, status, matchedAgent, crmAgent, outsideTeam }
    })
  )

  // Opportunistic org check for each matched agent on this lead (a
  // stale CRM link is refreshed here; otherwise it costs nothing). One
  // banner, de-duplicated — several calls by one agent don't repeat it.
  const seenNotes = new Map<string, OrgNote>()
  // One check per distinct matched agent (not per call).
  const orgChecks = new Map<string, Promise<OrgNote[]>>()
  for (const r of rows) {
    if (r.matchedAgent && !orgChecks.has(r.matchedAgent.id)) {
      orgChecks.set(r.matchedAgent.id, checkOrgSync(r.matchedAgent.id, r.call.created_by.id, viewer.profile.id))
    }
  }
  const notesPerAgent = await Promise.all(orgChecks.values())
  for (const n of notesPerAgent.flat()) {
    seenNotes.set(`${n.level}|${n.subject}|${n.crmName}|${n.ourName}|${n.weHaveNone}`, n)
  }
  const orgNotes = [...seenNotes.values()].sort((a, b) => a.level.localeCompare(b.level))

  const lead = calls[0].lead

  return (
    <div>
      <BackLink />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>
        {lead?.name || `Lead #${leadId}`}
      </h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {[lead?.phone, lead?.class, lead?.group, lead?.stage].filter(Boolean).join(' · ') || `Lead ID ${leadId}`}
      </p>
      <OrgSyncBanner notes={orgNotes} canManageUsers={['super_admin', 'qa_manager'].includes(viewer.role)} />
      <CallList
        rows={rows}
        leadId={leadId}
        agentOptions={agentOptions}
        canManageUsers={['super_admin', 'qa_manager'].includes(viewer.role)}
      />
    </div>
  )
}

function BackLink() {
  return (
    <>
      <Link href="/audits" style={{ fontSize: '13px', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← New lookup
      </Link>
      <div style={{ height: '12px' }} />
    </>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{
      background: 'var(--alert-light)', border: '1px solid var(--alert)',
      borderRadius: 'var(--radius-md)', padding: '20px', color: 'var(--alert)', fontSize: '14px',
    }}>
      {message}
    </div>
  )
}

function EmptyState({ leadId }: { leadId: string }) {
  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center',
      color: 'var(--text-muted)', fontSize: '14px',
    }}>
      No calls found for lead {leadId}.
    </div>
  )
}
