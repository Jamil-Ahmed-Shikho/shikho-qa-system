import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { PendingReauditsSection } from '@/components/dashboard/PendingReauditsSection'
import { countDisputesAwaitingDecision } from '@/lib/disputes/disputes.service'

export default async function AdminDashboardPage() {
  // How many disputes are waiting for a decision (null = couldn't be counted / not set up yet).
  const waiting = await countDisputesAwaitingDecision().catch(() => null)
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
          href="/admin/disputes"
          title={waiting ? `Disputes (${waiting} waiting)` : 'Disputes'}
          description="Audits agents (or their Team Leads) have disputed: review and record a decision."
        />
        <NavCard
          href="/admin/ojt"
          title="OJT Management"
          description="Everyone in OJT or re-training: certify, re-train, not certify or discontinue, with a full history."
        />
        <NavCard
          href="/admin/targets"
          title="Audit & revenue targets"
          description="Weekly audit and revenue targets by vintage and team. Changes never rewrite past weeks."
        />
        <NavCard
          href="/admin/pip"
          title="PIP"
          description="Performance improvement plans: policy, monthly cycles, suggested candidates, approvals."
        />
        <NavCard
          href="/calibration"
          title="Calibration sessions"
          description="Schedule team calibration sessions and calibrate with QA teammates."
        />
        <NavCard
          href="/audits"
          title="Audit a Call"
          description="Look up a lead's call history and start an audit."
        />
      </div>

      <PendingReauditsSection />

      <CalibrationSection />
      <BriefingsSection audience="org" />
    </div>
  )
}
