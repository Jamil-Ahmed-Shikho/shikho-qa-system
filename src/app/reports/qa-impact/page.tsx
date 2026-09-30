import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatUsd } from '@/lib/money/usd'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingQaImpactSchema,
  loadCoachingImpact,
  loadRevenueGrowthByChannel,
  type CoachingImpactRow,
  type CoachingOutcome,
  type RevenueGrowthRow,
} from '@/lib/qa-impact/qa-impact.service'
import Link from 'next/link'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '100px', textAlign: 'center' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

const OUTCOME_COLOR: Record<CoachingOutcome, string> = { improved: 'var(--status-green)', declined: 'var(--alert)', same: 'var(--text-muted)', pending: 'var(--highlight)' }
const OUTCOME_LABEL: Record<CoachingOutcome, string> = { improved: 'Improved', declined: 'Declined', same: 'No change', pending: 'Pending next audit' }

function ViewToggle({ view, base, period }: { view: QaRankingView; base: string; period: string }) {
  const tab = (v: QaRankingView, text: string) => (
    <Link
      href={`${base}?period=${period}&view=${v}`}
      aria-current={view === v ? 'page' : undefined}
      style={{
        padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)',
        borderWidth: '1px', borderStyle: 'solid', borderColor: view === v ? 'var(--brand)' : 'var(--border)',
        background: view === v ? 'var(--brand)' : 'transparent', color: view === v ? '#fff' : 'inherit',
      }}
    >
      {text}
    </Link>
  )
  return <div style={{ display: 'flex', gap: '8px' }}>{tab('mine', 'My view')}{tab('team', 'Team view')}</div>
}

function CoachingImpactSection({ rows }: { rows: CoachingImpactRow[] }) {
  const evaluated = rows.filter((r) => r.outcome !== 'pending')
  const improved = evaluated.filter((r) => r.outcome === 'improved').length
  const declined = evaluated.filter((r) => r.outcome === 'declined').length
  const same = evaluated.filter((r) => r.outcome === 'same').length
  const pending = rows.length - evaluated.length
  const avgDelta = evaluated.length > 0 ? Math.round((evaluated.reduce((s, r) => s + (r.scoreDelta ?? 0), 0) / evaluated.length) * 10) / 10 : null

  if (rows.length === 0) {
    return <p style={empty}>No completed, attended coaching sessions in this period.</p>
  }
  return (
    <>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--status-green)' }}>{improved}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Improved</div></div>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--alert)' }}>{declined}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Declined</div></div>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700 }}>{same}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No change</div></div>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--highlight)' }}>{pending}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pending</div></div>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700 }}>{avgDelta !== null ? (avgDelta > 0 ? `+${avgDelta}` : avgDelta) : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg score change (pts)</div></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
          <thead>
            <tr>
              <th style={th}>Agent</th>
              <th style={th}>Team / Site</th>
              <th style={th}>Coaching date</th>
              <th style={th}>Before</th>
              <th style={th}>After</th>
              <th style={th}>Change</th>
              <th style={th}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.briefingId}>
                <td style={td}><b>{r.agentName}</b></td>
                <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                <td style={td}>{formatDhakaDateTime(r.coachingDate)}</td>
                <td style={td}>{r.beforeScore}%</td>
                <td style={td}>{r.afterScore !== null ? `${r.afterScore}%` : '—'}</td>
                <td style={td}>{r.scoreDelta !== null ? (r.scoreDelta > 0 ? `+${r.scoreDelta}` : r.scoreDelta) : '—'}</td>
                <td style={td}><span style={{ color: OUTCOME_COLOR[r.outcome], fontWeight: 600 }}>{OUTCOME_LABEL[r.outcome]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function RevenueGrowthSection({ rows }: { rows: RevenueGrowthRow[] }) {
  if (rows.length === 0) return <p style={empty}>No eligible agents in scope for this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Channel</th>
            <th style={th}>Agents</th>
            <th style={th}>This period</th>
            <th style={th}>Prior period</th>
            <th style={th}>Growth %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td style={td}><b>{r.channel}</b></td>
              <td style={td}>{r.agentsCount}</td>
              <td style={td}>{formatUsd(r.revenueNowUsd)}</td>
              <td style={td}>{formatUsd(r.revenuePriorUsd)}</td>
              <td style={td}>
                {r.growthPct === null ? '—' : (
                  <span style={{ color: r.growthPct >= 0 ? 'var(--status-green)' : 'var(--alert)', fontWeight: 600 }}>
                    {r.growthPct > 0 ? '+' : ''}{r.growthPct}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function QaImpactPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let coaching: CoachingImpactRow[] = []
  let revenue: RevenueGrowthRow[] = []
  let failure: unknown = null
  try {
    ;[coaching, revenue] = await Promise.all([
      loadCoachingImpact(range.from, range.to, view),
      loadRevenueGrowthByChannel(range.from, range.to, view),
    ])
  } catch (err) {
    failure = err
    if (!isMissingQaImpactSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Coaching Impact &amp; Revenue Growth</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Whether coaching sessions actually improve the agent&apos;s next audit score, and how revenue is trending
        by channel.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-impact?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} base="/reports/qa-impact" period={period} />}
      </div>

      {failure ? (
        isMissingQaImpactSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_055_qa_dashboard_stage4.sql</code> (after 054), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <h2 style={sectionTitle}>Coaching impact</h2>
            <p style={sectionNote}>
              For every completed, attended coaching session in this period: the score on the audit that triggered
              it (&ldquo;before&rdquo;) vs. the agent&apos;s next submitted audit afterward (&ldquo;after&rdquo;).
              &ldquo;Pending&rdquo; means nothing has been audited for that agent since the session yet.
            </p>
            <CoachingImpactSection rows={coaching} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Revenue growth by channel</h2>
            <p style={sectionNote}>This period&apos;s USD revenue vs. the immediately preceding period of the same length — OJT is broken out as its own group.</p>
            <RevenueGrowthSection rows={revenue} />
          </div>
        </>
      )}
    </div>
  )
}
