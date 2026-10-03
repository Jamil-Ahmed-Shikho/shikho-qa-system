import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { AgentProfileView } from '@/components/audits/AgentProfileView'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadBrowsableAgent } from '@/lib/audits/agent-call-browser.service'
import { loadAgentDashboard } from '@/lib/agents/agent-dashboard.service'

export default async function AgentProfilePage({ params }: { params: Promise<{ agentId: string }> }) {
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')
  if (!['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(viewer.role)) redirect('/dashboard')

  const { agentId } = await params

  const agent = await loadBrowsableAgent(agentId)
  if (!agent) {
    return (
      <div>
        <BackLink href="/dashboard" label="Dashboard" />
        <ErrorState message="No such agent." />
      </div>
    )
  }

  let dashboard
  let failed = false
  try {
    dashboard = await loadAgentDashboard(agentId, agent.name)
  } catch (err) {
    failed = true
    console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 4px' }}>
        {[agent.teamName, agent.siteName].filter(Boolean).join(' · ') || agent.email}
        {' · '}
        <a href={`/audits/agent/${encodeURIComponent(agent.id)}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>
          Browse this agent&apos;s calls to audit →
        </a>
      </p>

      {failed || !dashboard ? (
        <ErrorState message="This agent's history could not be loaded right now — this does not mean there is none." />
      ) : (
        <AgentProfileView data={dashboard} historyHref={`/audits/agent/${encodeURIComponent(agent.id)}/history`} />
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
