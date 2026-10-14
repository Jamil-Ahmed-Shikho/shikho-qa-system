import Link from 'next/link'
import { AdminLiveSnapshot } from '@/components/dashboard/admin/AdminLiveSnapshot'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { DashboardSection } from '@/components/dashboard/DashboardSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { PendingReauditsSection } from '@/components/dashboard/PendingReauditsSection'
import { countReviewRequestsAwaitingDecision } from '@/lib/review-requests/review-requests.service'

// ============================================================
// SHIKHO QA SYSTEM — Admin Dashboard (redesigned 2026-10-14). Previously 19
// identical flat NavCards with no grouping and almost no live data. Now:
// a live snapshot (today/this week/status/auditor progress — all reused
// Team-View loaders, see AdminLiveSnapshot), two Quick Action cards for the
// actual day-to-day QA tasks, then the remaining cards grouped by what
// they're actually for (Action Needed / Monitoring & Oversight / Reports,
// Analysis & TNI / Maintenance & Configuration). Every original href is
// still reachable — nothing was dropped, only reorganized.
//
// Super Admin and QA Manager share this exact page today (zero role
// branching) — trimming it to QA Manager's actual entitlements is a
// separate, later task, not part of this redesign.
// ============================================================

const ctaStyle = (variant: 'primary' | 'secondary'): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '14px', flex: '1 1 260px', minWidth: '240px',
  padding: '18px 20px', borderRadius: 'var(--radius-lg)', textDecoration: 'none',
  background: variant === 'primary' ? 'linear-gradient(135deg, var(--brand) 0%, #4A3A9E 100%)' : 'var(--paper)',
  border: variant === 'primary' ? 'none' : '1px solid var(--border)',
  color: variant === 'primary' ? 'white' : 'var(--text-primary)',
})

export default async function AdminDashboardPage() {
  const waiting = await countReviewRequestsAwaitingDecision().catch(() => null)

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Admin Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Rubric, policy, and org administration.
      </p>

      {/* 1. Live snapshot — today, this week, status overview, auditor progress & impact */}
      <AdminLiveSnapshot />

      {/* 2. Quick actions — the actual day-to-day QA tasks, not admin configuration */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '28px' }}>
        <Link href="/audits" style={ctaStyle('primary')}>
          <i className="ti ti-phone-call" aria-hidden style={{ fontSize: '26px' }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>Audit a Call</div>
            <div style={{ fontSize: '12.5px', opacity: 0.9 }}>Look up a lead's call history and start an audit.</div>
          </div>
        </Link>
        <Link href="/calibration" style={ctaStyle('secondary')}>
          <i className="ti ti-users" aria-hidden style={{ fontSize: '26px', color: 'var(--brand)' }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>Calibration sessions</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Schedule and calibrate with QA teammates.</div>
          </div>
        </Link>
      </div>

      {/* 3. Action Needed */}
      <DashboardSection title="Action Needed" icon="ti-alert-triangle" description="Things waiting on a decision.">
        <NavCard
          href="/admin/review-requests"
          icon="ti-arrow-back-up"
          title={waiting ? `Review Requests (${waiting} waiting)` : 'Review Requests'}
          description="Audits agents (or their Team Lead/Manager) have requested a review of: assign, re-audit and decide."
        />
        <NavCard
          href="/admin/ojt"
          icon="ti-school"
          title="OJT Management"
          description="Everyone in OJT or re-training: certify, re-train, not certify or discontinue, with a full history."
        />
        <NavCard
          href="/admin/pip"
          icon="ti-clipboard-check"
          title="PIP"
          description="Performance improvement plans: policy, monthly cycles, suggested candidates, approvals."
        />
      </DashboardSection>
      <PendingReauditsSection />

      {/* 4. Monitoring & Oversight */}
      <DashboardSection title="Monitoring & Oversight" icon="ti-activity" description="How things stand right now.">
        <NavCard
          href="/reports/qa-status-overview"
          icon="ti-gauge"
          title="RYG, PIP, Zero-Seller & Fatal Overview"
          description="Who's Red/Yellow/Green, who's on a zero-seller streak, current PIP progress against target, and every critical-fatal audit."
        />
        <NavCard
          href="/reports/qa-team-progress"
          icon="ti-calendar-stats"
          title="This Week's QA Progress"
          description="Per-auditor audit/coaching progress, channel-wise audit target vs completion, and the OJT/re-training pipeline."
        />
        <NavCard
          href="/reports/evaluation-tracking"
          icon="ti-mail-opened"
          title="Evaluation Email Tracking"
          description="Has each agent clicked through to their result email, or is it still unseen?"
        />
        <NavCard
          href="/dashboard/manager"
          icon="ti-sitemap"
          title="Manager Dashboards"
          description="Performance rolled up across a Manager's Team Leads and agents."
        />
      </DashboardSection>

      {/* 5. Reports, Analysis & TNI */}
      <DashboardSection title="Reports, Analysis & TNI" icon="ti-chart-bar" description="Deeper dives and training-needs patterns.">
        <NavCard
          href="/reports/qa-auditor-ranking"
          icon="ti-trophy"
          title="Auditor's Impact Report"
          description="A weighted Total Score per QA Auditor — audit coverage, coaching, sales growth, vintage revenue targets, and Red/Yellow/Zero-Seller recovery."
        />
        <NavCard
          href="/reports/repeat-mistakes"
          icon="ti-repeat"
          title="Repeat-Mistake Report"
          description="Agents whose audits show the same rubric parameter failing repeatedly — flagged automatically, for spotting training-needs patterns."
        />
        <NavCard
          href="/reports/qa-rubric-trends"
          icon="ti-chart-line"
          title="Rubric Fail Trends"
          description="Which rubric parameters fail most often, and whether each is getting better or worse."
        />
        <NavCard
          href="/reports/campaigns"
          icon="ti-chart-pie"
          title="Special Check Report"
          description="How agents answered a Special Check, over submitted audits — filterable by team, site, agent, auditor and date."
        />
        <NavCard
          href="/reports/qa-impact"
          icon="ti-trending-up"
          title="Coaching Impact & Revenue Growth"
          description="Score before vs. after coaching sessions, and revenue growth by channel."
        />
        <NavCard
          href="/reports/qa-oversight"
          icon="ti-scale"
          title="Review Request & Calibration Oversight"
          description="What's stuck, Team Lead/auditor outcomes, and how consistently the team scores together."
        />
      </DashboardSection>

      {/* 6. Maintenance & Configuration */}
      <DashboardSection title="Maintenance & Configuration" icon="ti-settings" description="Rarely-touched setup." muted>
        <NavCard
          href="/admin/users"
          icon="ti-users"
          title="Users"
          description="Add and edit agents, team leads and auditors. Bulk import from Excel."
        />
        <NavCard
          href="/admin/rubrics"
          icon="ti-clipboard-list"
          title="Rubrics"
          description="Manage scoring rubrics, categories, parameters, and fatal error lists."
        />
        <NavCard
          href="/admin/campaigns"
          icon="ti-list-check"
          title="Special Checks"
          description="Temporary management checks (campaigns) added to audits without affecting the score."
        />
        <NavCard
          href="/admin/targets"
          icon="ti-target"
          title="Audit & revenue targets"
          description="Weekly audit and revenue targets by vintage and team. Changes never rewrite past weeks."
        />
        <NavCard
          href="/admin/holidays"
          icon="ti-calendar"
          title="Holiday calendar"
          description="Mark holidays with a note, per site or both — this week's audit targets shrink automatically to match (§9.4)."
        />
      </DashboardSection>

      <CalibrationSection />
      <BriefingsSection audience="org" />
    </div>
  )
}
