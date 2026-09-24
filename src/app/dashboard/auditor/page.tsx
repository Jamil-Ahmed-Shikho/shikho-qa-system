import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { getAuthUser } from '@/lib/auth/auth.service'
import { NavCard } from '@/components/dashboard/NavCard'

export default async function AuditorDashboardPage() {
  const user = await getAuthUser()
  // A QA Auditor sees their own schedule; a QA Manager / Admin opening this page sees everyone's.
  const audience = user?.role === 'qa_auditor' ? 'auditor' : 'org'
  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>QA Auditor Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Your audit queue, targets, and tools.
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
          description="How agents answered a Special Check, over submitted audits — company-wide, not just your own."
        />
      </div>

      <BriefingsSection audience={audience} />
    </div>
  )
}
