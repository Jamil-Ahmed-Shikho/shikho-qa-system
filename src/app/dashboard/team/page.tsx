import { NavCard } from '@/components/dashboard/NavCard'

export default function TeamDashboardPage() {
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
      </div>
    </div>
  )
}
