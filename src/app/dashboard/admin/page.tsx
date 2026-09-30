import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { PendingReauditsSection } from '@/components/dashboard/PendingReauditsSection'
import { countReviewRequestsAwaitingDecision } from '@/lib/review-requests/review-requests.service'

export default async function AdminDashboardPage() {
  // How many Review Requests are waiting for QA Manager (null = couldn't be counted / not set up yet).
  const waiting = await countReviewRequestsAwaitingDecision().catch(() => null)
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
          href="/reports/repeat-mistakes"
          title="Repeat-Mistake Report"
          description="Agents whose audits show the same rubric parameter failing repeatedly — flagged automatically, for spotting training-needs patterns."
        />
        <NavCard
          href="/reports/qa-auditor-ranking"
          title="Auditor Ranking"
          description="Audit coverage, coaching, sales growth and PIP/Zero-Seller recovery — a Total Score per QA Auditor."
        />
        <NavCard
          href="/reports/qa-team-progress"
          title="This Week's QA Progress"
          description="Per-auditor audit/coaching progress, channel-wise audit target vs completion, and the OJT/re-training pipeline."
        />
        <NavCard
          href="/reports/qa-status-overview"
          title="RYG, PIP, Zero-Seller & Fatal Overview"
          description="Who's Red/Yellow/Green, who's on a zero-seller streak, current PIP progress against target, and every critical-fatal audit."
        />
        <NavCard
          href="/reports/qa-impact"
          title="Coaching Impact & Revenue Growth"
          description="Score before vs. after coaching sessions, and revenue growth by channel."
        />
        <NavCard
          href="/reports/qa-oversight"
          title="Review Request & Calibration Oversight"
          description="What's stuck, Team Lead/auditor outcomes, and how consistently the team scores together."
        />
        <NavCard
          href="/admin/review-requests"
          title={waiting ? `Review Requests (${waiting} waiting)` : 'Review Requests'}
          description="Audits agents (or their Team Lead/Manager) have requested a review of: assign, re-audit and decide."
        />
        <NavCard
          href="/admin/team-lead-checks"
          title="Team Leader Checks"
          description="Manage the lightweight checks Team Leads can log on their own agents' calls, and see every check logged."
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
