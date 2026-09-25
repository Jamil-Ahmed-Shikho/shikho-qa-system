import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { getAuthUser } from '@/lib/auth/auth.service'
import { NavCard } from '@/components/dashboard/NavCard'

export default async function TeamDashboardPage() {
  const user = await getAuthUser()
  // A Team Lead sees their own team's sessions; a QA Manager / Admin opening this page sees everyone's.
  const audience = user?.role === 'team_lead' ? 'scope' : 'org'
  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Team Lead Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Your team's coverage, scores, and audit tools.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        <NavCard
          href="/audits"
          title="Audit a Call"
          description="Look up a lead's call history and start an audit."
        />
        <NavCard
          href="/reports/campaigns"
          title="Campaign Report"
          description="How your team answered a Special Check, over submitted audits."
        />
        <NavCard
          href="/pip"
          title="PIP — your agents"
          description="Agents on a performance improvement plan: give your feedback on their progress."
        />
      </div>

      <BriefingsSection audience={audience} />
    </div>
  )
}
