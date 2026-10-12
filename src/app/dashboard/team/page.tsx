import Link from 'next/link'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { getAuthUser } from '@/lib/auth/auth.service'
import { CalibrationSection } from '@/components/dashboard/CalibrationSection'
import { NavCard } from '@/components/dashboard/NavCard'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import { loadTeamLeadDashboard } from '@/lib/team-lead/team-lead-dashboard.service'
import { TeamLeadDashboardView } from '@/components/dashboard/team-lead/TeamLeadDashboardView'
import { TeamLeadAgentPerformanceSection } from '@/components/dashboard/team-lead/TeamLeadAgentPerformanceSection'

export default async function TeamDashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await getAuthUser()
  const sp = await searchParams
  // A Team Lead sees their own team's sessions; a QA Manager / Admin opening this page sees everyone's.
  const audience = user?.role === 'team_lead' ? 'scope' : 'org'
  const isTeamLead = user?.role === 'team_lead'
  const period = parsePeriod(sp.period)
  const range = periodRange(period)

  let dashboard: Awaited<ReturnType<typeof loadTeamLeadDashboard>> | null = null
  let failure: unknown = null
  if (isTeamLead && user) {
    try {
      dashboard = await loadTeamLeadDashboard(user.profile.id, user.profile.name, range.from, range.to)
    } catch (err) {
      failure = err
      console.error(err)
    }
  }

  // Built once, placed either inside TeamLeadDashboardView's reordered layout (a real Team Lead,
  // right under the KPIs/attention strip — Jamil's own standardization request, 2026-10-12) or
  // standalone below (a Super Admin / QA Manager browsing this page, who gets no personal dashboard
  // data) — same cards, same position relative to "nothing else is a Team Lead's own data" either way.
  const quickActionsNode = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
      {/* No "Calibration sessions" nav card here (2026-10-12, Jamil's own catch) — a Team Lead
          can't schedule one (§5: QA function only), so the CalibrationSection below already
          covers everything this card would: what you're invited to, plus its own "All sessions"
          link to the exact same /calibration destination. Nothing left for the card to add. */}
      <NavCard
        href="/audits"
        title="Audit a Call"
        description="Look up a lead's call history and start an audit."
      />
      <NavCard
        href="/reports/campaigns"
        title="Special Check Report"
        description="How your team answered a Special Check, over submitted audits."
      />
      <NavCard
        href="/reports/repeat-mistakes"
        title="Repeat-Mistake Report"
        description="Agents on your team whose audits show the same rubric parameter failing repeatedly."
      />
      <NavCard
        href="/reports/qa-rubric-trends"
        title="Rubric Fail Trends"
        description="Which rubric parameters your team is failing most, by skill area, and whether it's improving."
      />
      <NavCard
        href="/reports/evaluation-tracking"
        title="Evaluation Email Tracking"
        description="Has each agent clicked through to their result email, or is it still unseen?"
      />
      <NavCard
        href="/pip"
        title="PIP — your agents"
        description="Agents on a performance improvement plan: give your feedback on their progress."
      />
    </div>
  )

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Team Lead Dashboard</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Your team's coverage, scores, and audit tools.
      </p>

      {isTeamLead && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/dashboard/team?period=${p.value}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
      )}

      {failure ? (
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px', marginBottom: '20px' }}>Your team's stats could not be loaded right now. Try again shortly.</div>
      ) : null}

      {dashboard
        ? <TeamLeadDashboardView data={dashboard} agentPerformance={<TeamLeadAgentPerformanceSection />} quickActions={quickActionsNode} />
        : quickActionsNode}

      <CalibrationSection />
      <BriefingsSection audience={audience} />
    </div>
  )
}
