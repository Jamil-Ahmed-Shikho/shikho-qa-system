import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingQaRubricTrendsSchema,
  loadRubricFailTrends,
  type RubricFailTrendRow,
} from '@/lib/qa-rubric-trends/qa-rubric-trends.service'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

function ViewToggle({ view, period }: { view: QaRankingView; period: string }) {
  const tab = (v: QaRankingView, text: string) => (
    <Link
      href={`/reports/qa-rubric-trends?period=${period}&view=${v}`}
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

function TrendBadge({ points }: { points: number | null }) {
  if (points === null) return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No prior data</span>
  if (points > 0.5) return <span style={{ color: 'var(--alert)', fontWeight: 600 }}>▲ +{points}pp</span>
  if (points < -0.5) return <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>▼ {points}pp</span>
  return <span style={{ color: 'var(--text-muted)' }}>— steady</span>
}

function RubricTrendsTable({ rows }: { rows: RubricFailTrendRow[] }) {
  if (rows.length === 0) return <p style={empty}>No audits scored in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
        <thead>
          <tr>
            <th style={th}>Parameter</th>
            <th style={th}>Category / Rubric</th>
            <th style={th}>Scored</th>
            <th style={th}>Failed</th>
            <th style={th}>Fail rate</th>
            <th style={th}>Prior period</th>
            <th style={th}>Trend</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.parameterId}>
              <td style={{ ...td, fontWeight: 600 }}>{r.parameterName}</td>
              <td style={td}>{r.categoryName}<div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.rubricName}</div></td>
              <td style={td}>{r.totalScored}</td>
              <td style={td}>{r.totalFailed}</td>
              <td style={{ ...td, fontWeight: 700 }}>{r.failRatePct}%</td>
              <td style={td}>{r.priorFailRatePct !== null ? `${r.priorFailRatePct}%` : '—'}</td>
              <td style={td}><TrendBadge points={r.trendPctPoints} /></td>
              <td style={td}>
                <Link href={`/reports/repeat-mistakes?parameter=${r.parameterId}`} style={{ fontSize: '12.5px', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
                  Who&apos;s failing it →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function QaRubricTrendsPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let rows: RubricFailTrendRow[] = []
  let failure: unknown = null
  try {
    rows = await loadRubricFailTrends(range.from, range.to, view)
  } catch (err) {
    failure = err
    if (!isMissingQaRubricTrendsSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Rubric Fail Trends</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Which rubric parameters are failing most often, and whether each one is getting better or worse compared
        to the immediately preceding period of the same length.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-rubric-trends?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} period={period} />}
      </div>

      {failure ? (
        isMissingQaRubricTrendsSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_060_qa_dashboard_stage6.sql</code> (after 059), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <div style={card}>
          <p style={sectionNote}>Sorted worst fail rate first. &ldquo;Who&apos;s failing it&rdquo; opens the Repeat-Mistake Report filtered to that parameter.</p>
          <RubricTrendsTable rows={rows} />
        </div>
      )}
    </div>
  )
}
