import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCallsForLead, CrmApiError } from '@/lib/crm/client'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getCallStatusMap } from '@/lib/audits/audits.service'
import { resolveAgentForCall, listActiveAgents, findCallOwner } from '@/lib/audits/agent-matching'
import { checkOrgSync, type OrgNote } from '@/lib/crm/org-sync'
import { CallList, type CallRow } from '@/components/audits/CallList'
import { OrgSyncBanner } from '@/components/audits/OrgSyncBanner'

export default async function LeadCallsPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params

  // Looked up first: the CRM request is logged against this person.
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')

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

  const statusMap = await getCallStatusMap(calls.map((c) => String(c.id)))
  const agentOptions = await listActiveAgents()

  const isTeamLead = viewer.role === 'team_lead'
  const rows: CallRow[] = await Promise.all(
    calls.map(async (call) => {
      const status = statusMap.get(String(call.id)) ?? null
      const { match: matchedAgent, crm: crmAgent } = await resolveAgentForCall(call.created_by, viewer.profile.id)
      // A Team Lead audits only their own team's calls. Unknown owners
      // count as "not yours" — the call can't be shown to be theirs.
      let outsideTeam: boolean | undefined
      if (isTeamLead) {
        const owner = await findCallOwner(call.created_by, viewer.profile.id)
        outsideTeam = !owner || owner.team_leader_id !== viewer.profile.id
      }
      return { call, status, matchedAgent, crmAgent, outsideTeam }
    })
  )

  // Opportunistic org check for each matched agent on this lead (a
  // stale CRM link is refreshed here; otherwise it costs nothing). One
  // banner, de-duplicated — several calls by one agent don't repeat it.
  const seenNotes = new Map<string, OrgNote>()
  const notesPerAgent = await Promise.all(
    rows
      .filter((r) => r.matchedAgent)
      .map((r) => checkOrgSync(r.matchedAgent!.id, r.call.created_by.id, viewer.profile.id))
  )
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
