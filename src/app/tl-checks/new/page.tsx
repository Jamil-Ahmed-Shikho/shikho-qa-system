import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { TlCheckForm } from '@/components/team-lead-checks/TlCheckForm'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getCallById, CrmApiError } from '@/lib/crm/client'
import { loadBrowsableAgent } from '@/lib/team-lead-checks/call-browser.service'
import { isMissingTlCheckSchema, loadActiveTlCheckTypes } from '@/lib/team-lead-checks/definitions.service'
import { formatCrmDateTime } from '@/lib/dates/format'

export default async function NewTlCheckPage({ searchParams }: { searchParams: Promise<{ agent?: string; lead?: string; call?: string }> }) {
  const user = await getAuthUser()
  if (!user) redirect('/auth/login')
  if (user.role !== 'team_lead') redirect('/dashboard')

  const sp = await searchParams
  const agentId = sp.agent
  const leadId = sp.lead
  const callId = sp.call
  if (!agentId || !leadId || !callId) redirect('/tl-checks')

  const agent = await loadBrowsableAgent(agentId)
  if (!agent) {
    return (
      <div>
        <BackLink href="/tl-checks" label="Team Leader Checks" />
        <ErrorState message="That agent could not be found, or isn't on your team." />
      </div>
    )
  }

  let call
  try {
    call = await getCallById(callId, user.profile.id)
  } catch (err) {
    const message = err instanceof CrmApiError ? err.message : 'Could not reach the CRM.'
    return (
      <div>
        <BackLink href={`/tl-checks/agent/${agentId}`} label={`${agent.name}'s calls`} />
        <ErrorState message={message} />
      </div>
    )
  }
  if (!call || String(call.lead_id) !== String(leadId)) {
    return (
      <div>
        <BackLink href={`/tl-checks/agent/${agentId}`} label={`${agent.name}'s calls`} />
        <ErrorState message="That call was not found on this lead in the CRM." />
      </div>
    )
  }

  let checkTypes: Awaited<ReturnType<typeof loadActiveTlCheckTypes>> = []
  let failure: unknown = null
  try {
    checkTypes = await loadActiveTlCheckTypes()
  } catch (err) {
    failure = err
    if (!isMissingTlCheckSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href={`/tl-checks/agent/${agentId}`} label={`${agent.name}'s calls`} />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Log a check — {agent.name}</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Call on {formatCrmDateTime(call.started_at)} · Lead {call.lead_id}
      </p>

      {failure ? (
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not load the available checks right now. Try again shortly.</div>
      ) : (
        <TlCheckForm agentId={agentId} leadId={String(leadId)} callId={String(callId)} checkTypes={checkTypes} backHref={`/tl-checks/agent/${agentId}`} />
      )}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--alert-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--alert)', fontSize: '14px', color: 'var(--alert)' }}>
      {message}
    </div>
  )
}
