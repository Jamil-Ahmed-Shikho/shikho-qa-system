import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { TEAM_NAMES, type TeamName } from '@/types/database.types'
import {
  buildCategoryRollup, buildSparkline, failRateSeverity, isSmallSample, trailingWeekStarts,
  type CategoryRollupRow, type SparklinePoint,
} from '@/lib/qa-rubric-trends/analysis'
import {
  isMissingQaRubricTrendsSchema,
  loadRubricFailTrendHistory,
  loadRubricFailTrends,
  type RubricFailTrendRow,
} from '@/lib/qa-rubric-trends/qa-rubric-trends.service'

const HISTORY_WEEKS = 8

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }
const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})

const SEVERITY_COLOR: Record<ReturnType<typeof failRateSeverity>, string> = {
  high: 'var(--alert)', moderate: 'var(--highlight)', low: 'var(--status-green)',
}

const CHANNEL_PARAM: Record<TeamName, string> = Object.fromEntries(TEAM_NAMES.map((t) => [t, t])) as Record<TeamName, string>

function parseChannel(raw: string | undefined): TeamName | null {
  if (raw === 'all') return null
  if (raw && (TEAM_NAMES as readonly string[]).includes(raw)) return raw as TeamName
  return 'Telesales' // default, per Jamil's request
}

function qs(period: string, view: string, channel: string): string {
  return `period=${period}&view=${view}&channel=${encodeURIComponent(channel)}`
}

function ViewToggle({ view, period, channel }: { view: QaRankingView; period: string; channel: string }) {
  const tab = (v: QaRankingView, text: string) => (
    <Link href={`/reports/qa-rubric-trends?${qs(period, v, channel)}`} aria-current={view === v ? 'page' : undefined} style={pill(view === v)}>
      {text}
    </Link>
  )
  return <div style={{ display: 'flex', gap: '8px' }}>{tab('mine', 'My view')}{tab('team', 'Team view')}</div>
}

function ChannelPicker({ channel, period, view }: { channel: TeamName | null; period: string; view: string }) {
  const current = channel ?? 'all'
  const option = (value: string, label: string) => (
    <Link key={value} href={`/reports/qa-rubric-trends?${qs(period, view, value)}`} aria-current={current === value ? 'page' : undefined} style={pill(current === value)}>
      {label}
    </Link>
  )
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Channel">
      {TEAM_NAMES.map((t) => option(CHANNEL_PARAM[t], t))}
      {option('all', 'All channels')}
    </div>
  )
}

function TrendBadge({ points }: { points: number | null }) {
  if (points === null) return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No prior data</span>
  if (points > 0.5) return <span style={{ color: 'var(--alert)', fontWeight: 600 }}>▲ +{points}pp</span>
  if (points < -0.5) return <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>▼ {points}pp</span>
  return <span style={{ color: 'var(--text-muted)' }}>— steady</span>
}

function FailRateCell({ failRatePct, totalScored }: { failRatePct: number; totalScored: number }) {
  const severity = failRateSeverity(failRatePct)
  return (
    <div>
      <span style={{ fontWeight: 700, color: SEVERITY_COLOR[severity] }}>{failRatePct}%</span>
      {isSmallSample(totalScored) && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }} title={`Based on only ${totalScored} scored audits — treat with caution.`}>
          small sample ({totalScored})
        </div>
      )}
    </div>
  )
}

/** A tiny, non-interactive line sparkline — no charting library, same "plain SVG, no dependency"
 *  convention as the Agent Dashboard's score trend chart. Rendered server-side (no client JS needed).
 *  A gap (null week — nothing scored) breaks the line rather than being drawn as 0%. */
function Sparkline({ points }: { points: SparklinePoint[] }) {
  const W = 112, H = 28
  const known = points.filter((p) => p.failRatePct !== null)
  if (known.length === 0) return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No history yet</span>

  const maxPct = Math.max(10, ...known.map((p) => p.failRatePct as number))
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * (W - 6) + 3 : W / 2)
  const y = (pct: number) => H - 3 - (pct / maxPct) * (H - 7)

  let path = ''
  let drawing = false
  points.forEach((p, i) => {
    if (p.failRatePct === null) { drawing = false; return }
    path += `${drawing ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.failRatePct).toFixed(1)} `
    drawing = true
  })

  const last = known[known.length - 1]
  const lastIdx = points.length - 1 - [...points].reverse().findIndex((p) => p.failRatePct !== null)
  const lastColor = SEVERITY_COLOR[failRateSeverity(last.failRatePct as number)]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Fail rate trend over the last ${points.length} weeks, ending at ${last.failRatePct}%`}>
      <path d={path.trim()} fill="none" stroke="var(--text-muted)" strokeOpacity={0.6} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(lastIdx)} cy={y(last.failRatePct as number)} r={2.5} fill={lastColor} />
    </svg>
  )
}

function CategoryRollupTable({ rows }: { rows: CategoryRollupRow[] }) {
  if (rows.length === 0) return <p style={empty}>No audits scored in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Category</th>
            <th style={th}>Rubric</th>
            <th style={th}>Scored</th>
            <th style={th}>Failed</th>
            <th style={th}>Fail rate</th>
            <th style={th}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.categoryId}>
              <td style={{ ...td, fontWeight: 600 }}>{c.categoryName}</td>
              <td style={td}>{c.rubricName}</td>
              <td style={td}>{c.totalScored}</td>
              <td style={td}>{c.totalFailed}</td>
              <td style={{ ...td, fontWeight: 700, color: SEVERITY_COLOR[failRateSeverity(c.failRatePct)] }}>{c.failRatePct}%</td>
              <td style={td}><TrendBadge points={c.trendPctPoints} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RubricTrendsTable({ rows, sparklines }: { rows: RubricFailTrendRow[]; sparklines: Map<string, SparklinePoint[]> }) {
  if (rows.length === 0) return <p style={empty}>No audits scored in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px' }}>
        <thead>
          <tr>
            <th style={th}>Parameter</th>
            <th style={th}>Category / Rubric</th>
            <th style={th}>Scored</th>
            <th style={th}>Failed</th>
            <th style={th}>Fail rate</th>
            <th style={th}>Prior period</th>
            <th style={th}>Trend</th>
            <th style={th}>Last {HISTORY_WEEKS} weeks</th>
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
              <td style={td}><FailRateCell failRatePct={r.failRatePct} totalScored={r.totalScored} /></td>
              <td style={td}>{r.priorFailRatePct !== null ? `${r.priorFailRatePct}%` : '—'}</td>
              <td style={td}><TrendBadge points={r.trendPctPoints} /></td>
              <td style={td}><Sparkline points={sparklines.get(r.parameterId) ?? []} /></td>
              <td style={td}>
                <Link href={`/reports/repeat-mistakes?parameter=${r.parameterId}`} prefetch={false} style={{ fontSize: '12.5px', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
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

export default async function QaRubricTrendsPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string; channel?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const channel = parseChannel(sp.channel)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  // A Team Lead/Manager always gets the one view — their own team or chain — same standing rule as
  // every other report in this system (§2): no channel picker, no My/Team toggle, nothing to choose.
  const isTeamLeadOrManager = user?.role === 'team_lead' || user?.role === 'manager'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'
  const effectiveChannel = isTeamLeadOrManager ? null : channel

  let rows: RubricFailTrendRow[] = []
  let sparklines = new Map<string, SparklinePoint[]>()
  let failure: unknown = null
  try {
    const weekStarts = trailingWeekStarts(HISTORY_WEEKS)
    const [trendRows, history] = await Promise.all([
      loadRubricFailTrends(range.from, range.to, view, effectiveChannel),
      loadRubricFailTrendHistory(HISTORY_WEEKS, view, effectiveChannel),
    ])
    rows = trendRows
    sparklines = new Map(rows.map((r) => [r.parameterId, buildSparkline(r.parameterId, history, weekStarts)]))
  } catch (err) {
    failure = err
    if (!isMissingQaRubricTrendsSchema(err)) console.error(err)
  }

  const categoryRows = buildCategoryRollup(rows)

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Rubric Fail Trends</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Which rubric parameters are failing most often, which skill area they fall under, and whether each one is
        getting better or worse
        {user?.role === 'team_lead' ? ' — scoped to your own team.' : user?.role === 'manager' ? ' — scoped to your own reporting chain.' : ' — for the channel you pick below.'}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-rubric-trends?${qs(p.value, view, channel ?? 'all')}`} role="tab" aria-selected={period === p.value} style={pill(period === p.value)}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} period={period} channel={channel ?? 'all'} />}
      </div>

      {!isTeamLeadOrManager && (
        <div style={{ marginBottom: '20px' }}>
          <ChannelPicker channel={channel} period={period} view={view} />
        </div>
      )}

      {failure ? (
        isMissingQaRubricTrendsSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_090_qa_rubric_trends_v2.sql</code> (after 089), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 2px' }}>By skill area</h2>
            <p style={sectionNote}>Every parameter in a category rolled up together — the widest training gaps, before the detail below.</p>
            <CategoryRollupTable rows={categoryRows} />
          </div>

          <div style={card}>
            <p style={sectionNote}>
              Sorted worst fail rate first. Fail rate is colored <span style={{ color: SEVERITY_COLOR.high, fontWeight: 600 }}>red at 40%+</span>,{' '}
              <span style={{ color: SEVERITY_COLOR.moderate, fontWeight: 600 }}>amber at 20–39%</span>, otherwise{' '}
              <span style={{ color: SEVERITY_COLOR.low, fontWeight: 600 }}>green</span>. A rate based on fewer than 10 scored audits is
              flagged &ldquo;small sample&rdquo; — treat it with caution. The last-{HISTORY_WEEKS}-weeks column always shows the trailing weeks
              regardless of the period picked above. &ldquo;Who&apos;s failing it&rdquo; opens the Repeat-Mistake Report filtered to that parameter.
            </p>
            <RubricTrendsTable rows={rows} sparklines={sparklines} />
          </div>
        </>
      )}
    </div>
  )
}
