import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { NavCard } from '@/components/dashboard/NavCard'

export default function AdminDashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Admin Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Rubric, policy, and org administration.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        <NavCard
          href="/admin/users"
          title="Users"
          description="Add and edit agents, team leads and auditors. Bulk import from Excel."
        />
        <NavCard
          href="/dashboard/manager"
          title="Manager Dashboards"
          description="Performance rolled up across a Manager's Team Leads and agents."
        />
        <NavCard
          href="/admin/rubrics"
          title="Rubrics"
          description="Manage scoring rubrics, categories, parameters, and fatal error lists."
        />
        <NavCard
          href="/admin/campaigns"
          title="Special Checks"
          description="Temporary management checks (campaigns) added to audits without affecting the score."
        />
        <NavCard
          href="/reports/campaigns"
          title="Campaign Report"
          description="How agents answered a Special Check, over submitted audits — filterable by team, site, agent, auditor and date."
        />
        <NavCard
          href="/audits"
          title="Audit a Call"
          description="Look up a lead's call history and start an audit."
        />
      </div>

      <BriefingsSection audience="org" />
    </div>
  )
}
