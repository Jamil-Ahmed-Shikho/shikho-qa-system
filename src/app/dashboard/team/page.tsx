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

      {dashboard && <TeamLeadDashboardView data={dashboard} agentPerformance={<TeamLeadAgentPerformanceSection />} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: isTeamLead ? '8px' : 0 }}>
        <NavCard
          href="/calibration"
          title="Calibration sessions"
          description="Calibration sessions you have been invited to."
        />
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
          href="/pip"
          title="PIP — your agents"
          description="Agents on a performance improvement plan: give your feedback on their progress."
        />
      </div>

      <CalibrationSection />
      <BriefingsSection audience={audience} />
    </div>
  )
}
