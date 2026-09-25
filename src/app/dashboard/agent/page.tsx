import { PlaceholderDashboard } from '@/components/dashboard/PlaceholderDashboard'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { getAuthUser } from '@/lib/auth/auth.service'

export default async function AgentDashboardPage() {
  const user = await getAuthUser()
  return (
    <div>
      <PlaceholderDashboard title="My Performance" />
      {/* Only for an actual agent: a Team Lead or admin who lands here would otherwise see their whole scope under "My". */}
      {user?.role === 'agent' && (
        <div style={{ marginTop: '20px' }}>
          <NavCard href="/my-audits" title="My audits" description="See your audits, the feedback, and dispute one you think is wrong." />
        </div>
      )}
      {user?.role === 'agent' && <BriefingsSection audience="agent" canOpenAudit={false} />}
    </div>
  )
}
