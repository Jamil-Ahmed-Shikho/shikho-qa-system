import Link from 'next/link'
import { AdminLiveSnapshot } from '@/components/dashboard/admin/AdminLiveSnapshot'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { DashboardSection } from '@/components/dashboard/DashboardSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { PendingReauditsSection } from '@/components/dashboard/PendingReauditsSection'
import { countReviewRequestsAwaitingDecision } from '@/lib/review-requests/review-requests.service'

// ============================================================
// SHIKHO QA SYSTEM — Admin Dashboard (redesigned 2026-10-14, refined same
// day on Jamil's feedback). Previously 19 identical flat NavCards with no
// grouping and almost no live data. Now: a live snapshot (today/this
// week/status/auditor progress — all reused Team-View loaders, see
// AdminLiveSnapshot), one Quick Action card for the actual day-to-day QA
// task, then the remaining cards grouped by what they're actually for
// (Action Needed / Monitoring & Oversight / Reports, Analysis & TNI /
// Maintenance & Configuration). Every original href is still reachable.
//
// Two refinements from Jamil's first look:
// (1) No card shows the same thing the live snapshot already shows. The
//     "Calibration sessions" Quick Action was dropped — CalibrationSection
//     (below) already surfaces upcoming sessions AND links to /calibration,
//     so the card was a second way to say the identical thing. The
//     "RYG, PIP, Zero-Seller & Fatal Overview", "This Week's QA Progress"
//     and "Auditor's Impact Report" nav cards were dropped the same way —
//     their content is already live on this page; AdminLiveSnapshot's own
//     section headers now carry the "View full report ->" link instead of a
//     separate card repeating the same title.
// (2) NavCard descriptions are gone from every card here — every
//     destination page already has its own <h1> + subtitle explaining
//     itself (confirmed by reading all of them), so the dashboard only
//     needs the title; the explanation shows once you're actually there,
//     not twice.
//
// Super Admin and QA Manager share this exact page today (zero role
// branching) — trimming it to QA Manager's actual entitlements is a
// separate, later task, not part of this redesign.
// ============================================================

const ctaStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '14px', width: '100%', maxWidth: '420px',
  padding: '18px 20px', borderRadius: 'var(--radius-lg)', textDecoration: 'none',
  background: 'linear-gradient(135deg, var(--brand) 0%, #4A3A9E 100%)', color: 'white',
}

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

      {/* 2. Quick action — the one thing QA actually does day to day */}
      <div style={{ marginBottom: '28px' }}>
        <Link href="/audits" style={ctaStyle}>
          <i className="ti ti-phone-call" aria-hidden style={{ fontSize: '26px' }} />
          <div style={{ fontSize: '15px', fontWeight: 700 }}>Audit a Call</div>
        </Link>
      </div>

      {/* 3. Action Needed */}
      <DashboardSection title="Action Needed" icon="ti-alert-triangle" description="Things waiting on a decision.">
        <NavCard href="/admin/review-requests" icon="ti-arrow-back-up" title={waiting ? `Review Requests (${waiting} waiting)` : 'Review Requests'} />
        <NavCard href="/admin/ojt" icon="ti-school" title="OJT Management" />
        <NavCard href="/admin/pip" icon="ti-clipboard-check" title="PIP" />
      </DashboardSection>
      <PendingReauditsSection />

      {/* 4. Monitoring & Oversight */}
      <DashboardSection title="Monitoring & Oversight" icon="ti-activity" description="How things stand right now.">
        <NavCard href="/reports/evaluation-tracking" icon="ti-mail-opened" title="Evaluation Email Tracking" />
        <NavCard href="/dashboard/manager" icon="ti-sitemap" title="Manager Dashboards" />
      </DashboardSection>

      {/* 5. Reports, Analysis & TNI */}
      <DashboardSection title="Reports, Analysis & TNI" icon="ti-chart-bar" description="Deeper dives and training-needs patterns.">
        <NavCard href="/reports/repeat-mistakes" icon="ti-repeat" title="Repeat-Mistake Report" />
        <NavCard href="/reports/qa-rubric-trends" icon="ti-chart-line" title="Rubric Fail Trends" />
        <NavCard href="/reports/campaigns" icon="ti-chart-pie" title="Special Check Report" />
        <NavCard href="/reports/qa-impact" icon="ti-trending-up" title="Coaching Impact & Revenue Growth" />
        <NavCard href="/reports/qa-oversight" icon="ti-scale" title="Review Request & Calibration Oversight" />
      </DashboardSection>

      {/* 6. Maintenance & Configuration */}
      <DashboardSection title="Maintenance & Configuration" icon="ti-settings" description="Rarely-touched setup." muted>
        <NavCard href="/admin/users" icon="ti-users" title="Users" />
        <NavCard href="/admin/rubrics" icon="ti-clipboard-list" title="Rubrics" />
        <NavCard href="/admin/campaigns" icon="ti-list-check" title="Special Checks" />
        <NavCard href="/admin/targets" icon="ti-target" title="Audit & revenue targets" />
        <NavCard href="/admin/holidays" icon="ti-calendar" title="Holiday calendar" />
      </DashboardSection>

      <CalibrationSection />
      <BriefingsSection audience="org" />
    </div>
  )
}
