import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { AgentProfileView } from '@/components/audits/AgentProfileView'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadBrowsableAgent } from '@/lib/audits/agent-call-browser.service'
import { loadAgentDashboard } from '@/lib/agents/agent-dashboard.service'

/**
 * A Manager-scoped read of an agent's profile — the same data QueueSection's
 * agent-name link shows a QA Auditor/Team Lead (/audits/agent/[agentId]/profile),
 * just reached from a route a Manager's role is actually allowed into (middleware's
 * /audits ROLE_ROUTES deliberately excludes manager — "a Manager doesn't audit
 * calls," §9 Part 2). `loadBrowsableAgent`/`loadAgentDashboard` are already generic
 * over agentId and run under the signed-in viewer's own session, so RLS
 * (manager_chain_ids()) does the real scoping — a Manager browsing an agent
 * outside their chain gets "No such agent," not someone else's data.
 *
 * The trend chart's dots don't link to /audits/{id} here (auditLinksEnabled=false)
 * — a Manager can't open that page either, so a live link would just redirect them
 * away with no explanation.
 */
export default async function ManagerAgentProfilePage({ params }: { params: Promise<{ agentId: string }> }) {
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')
  if (!['super_admin', 'qa_manager', 'manager'].includes(viewer.role)) redirect('/dashboard')

  const { agentId } = await params

  const agent = await loadBrowsableAgent(agentId)
  if (!agent) {
    return (
      <div>
        <BackLink href="/dashboard/manager" label="Manager Dashboard" />
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
      <BackLink href="/dashboard/manager" label="Manager Dashboard" />
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
        {[agent.teamName, agent.siteName].filter(Boolean).join(' · ') || agent.email}
      </p>

      {failed || !dashboard ? (
        <ErrorState message="This agent's history could not be loaded right now — this does not mean there is none." />
      ) : (
        <AgentProfileView
          data={dashboard}
          historyHref={`/dashboard/manager/agent/${encodeURIComponent(agent.id)}/history`}
          auditLinksEnabled={false}
        />
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
