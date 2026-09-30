import { AssignedReviewRequestsSection } from '@/components/dashboard/AssignedReviewRequestsSection'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { PendingReauditsSection } from '@/components/dashboard/PendingReauditsSection'
import { getAuthUser } from '@/lib/auth/auth.service'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { QueueSection } from '@/components/dashboard/QueueSection'

export default async function AuditorDashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getAuthUser()
  const sp = await searchParams
  // A QA Auditor defaults to their own portfolio; a QA Manager / Super Admin has no assigned portfolio, so defaults to everyone.
  const view = sp.view === 'mine' || sp.view === 'team' ? sp.view : user?.role === 'qa_auditor' ? 'mine' : 'team'
  // A QA Auditor sees their own schedule; a QA Manager / Admin opening this page sees everyone's.
  const audience = user?.role === 'qa_auditor' ? 'auditor' : 'org'
  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>QA Auditor Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Your audit queue, targets, and tools.
      </p>

      <QueueSection view={view} base="/dashboard/auditor" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '24px' }}>
        <NavCard
          href="/calibration"
          title="Calibration sessions"
          description="Schedule a calibration session, or see the ones you are invited to."
        />
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
        <NavCard
          href="/reports/repeat-mistakes"
          title="Repeat-Mistake Report"
          description="Agents whose audits show the same rubric parameter failing repeatedly — company-wide, not just your own."
        />
        <NavCard
          href="/reports/qa-auditor-ranking"
          title="Auditor Ranking"
          description="Your own audit/coaching/sales/PIP/Zero-Seller numbers, or everyone's — My view / Team view."
        />
        <NavCard
          href="/reports/qa-team-progress"
          title="This Week's QA Progress"
          description="Audit/coaching progress, channel-wise targets, and the OJT pipeline — My view / Team view."
        />
        <NavCard
          href="/reports/qa-status-overview"
          title="RYG, PIP, Zero-Seller & Fatal Overview"
          description="Who's Red/Yellow/Green, zero-seller streaks, current PIP progress, and critical-fatal audits — My view / Team view."
        />
        <NavCard
          href="/pip"
          title="PIP training"
          description="Agents on a performance improvement plan and their training sessions."
        />
      </div>

      <AssignedReviewRequestsSection />
      <PendingReauditsSection />

      <CalibrationSection />
      <BriefingsSection audience={audience} />
    </div>
  )
}
