import { PlaceholderDashboard } from '@/components/dashboard/PlaceholderDashboard'
import { AgentDashboardView } from '@/components/dashboard/AgentDashboardView'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { MyPipSection } from '@/components/dashboard/MyPipSection'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadAgentDashboard } from '@/lib/agents/agent-dashboard.service'

export default async function AgentDashboardPage() {
  const user = await getAuthUser()

  // Only for an actual agent: a Team Lead or admin who lands here would
  // otherwise see this labelled "My Performance" for a role it isn't theirs.
  if (user?.role !== 'agent') {
    return <PlaceholderDashboard title="My Performance" />
  }

  let dashboard: Awaited<ReturnType<typeof loadAgentDashboard>> | null = null
  let failed = false
  try {
    dashboard = await loadAgentDashboard(user.profile.id, user.profile.name)
  } catch (err) {
    console.error(err)
    failed = true
  }

  return (
    <div>
      {failed || !dashboard ? (
        <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--alert-light)', border: '1px solid var(--alert)', color: 'var(--alert)', fontSize: '14px', marginBottom: '20px' }}>
          Your performance summary could not be loaded right now. This does not mean there is nothing to show — try reloading shortly.
        </div>
      ) : (
        <AgentDashboardView data={dashboard} />
      )}

      <MyPipSection />
      <BriefingsSection audience="agent" canOpenAudit={false} />
    </div>
  )
}
