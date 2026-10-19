import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { TEAM_NAMES, type TeamName } from '@/types/database.types'
import {
  buildSparkline, failRateSeverity, isSmallSample, trailingWeekStarts, weekOverWeek,
  type SparklinePoint, type WeekOverWeek,
} from '@/lib/qa-rubric-trends/analysis'
import {
  isMissingQaRubricTrendsSchema,
  loadParameterCoachingList,
  loadRubricFailTrendHistory,
  loadRubricFailTrends,
  type ParameterCoachingRow,
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

function FailRateCell({ failRatePct, totalScored }: { failRatePct: number | null; totalScored: number }) {
  if (failRatePct === null) return <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No calls scored</span>
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

const COACHING_LIMIT = 10

/** A plain <details>/<summary> disclosure — click to expand, no client JS needed. Lists the agents
 *  who failed this parameter in the current sales week, worst first, capped so a parameter nearly
 *  everyone is failing doesn't produce an unreadably long list. */
function CoachingList({ rows }: { rows: ParameterCoachingRow[] }) {
  if (rows.length === 0) return <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Nobody failed this this week</span>
  const shown = rows.slice(0, COACHING_LIMIT)
  const extra = rows.length - shown.length
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: 'var(--brand)' }}>
        Needs coaching ({rows.length}) — show names
      </summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12.5px' }}>
        {shown.map((a) => (
          <li key={a.agentId} style={{ marginBottom: '2px' }}>
            {a.agentName} <span style={{ color: 'var(--text-muted)' }}>({a.failCount}×{a.teamLeaderName ? ` · TL: ${a.teamLeaderName}` : ''})</span>
          </li>
        ))}
      </ul>
      {extra > 0 && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>+{extra} more</div>}
    </details>
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

function RubricTrendsTable({
  rows, sparklines, wow, coaching,
}: {
  rows: RubricFailTrendRow[]
  sparklines: Map<string, SparklinePoint[]>
  wow: Map<string, WeekOverWeek>
  coaching: Map<string, ParameterCoachingRow[]>
}) {
  if (rows.length === 0) return <p style={empty}>No audits scored in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px' }}>
        <thead>
          <tr>
            <th style={th}>Parameter</th>
            <th style={th}>Category / Rubric</th>
            <th style={th}>Last week</th>
            <th style={th}>This week</th>
            <th style={th}>Trend</th>
            <th style={th}>Last {HISTORY_WEEKS} weeks</th>
            <th style={th}>Who needs coaching (this week)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = wow.get(r.parameterId)
            return (
              <tr key={r.parameterId}>
                <td style={{ ...td, fontWeight: 600 }}>{r.parameterName}</td>
                <td style={td}>{r.categoryName}<div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.rubricName}</div></td>
                <td style={td}><FailRateCell failRatePct={w?.lastWeekPct ?? null} totalScored={w?.lastWeekScored ?? 0} /></td>
                <td style={td}><FailRateCell failRatePct={w?.thisWeekPct ?? null} totalScored={w?.thisWeekScored ?? 0} /></td>
                <td style={td}><TrendBadge points={w?.trendDeltaPct ?? null} /></td>
                <td style={td}><Sparkline points={sparklines.get(r.parameterId) ?? []} /></td>
                <td style={td}><CoachingList rows={coaching.get(r.parameterId) ?? []} /></td>
              </tr>
            )
          })}
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
  let wow = new Map<string, WeekOverWeek>()
  let coaching = new Map<string, ParameterCoachingRow[]>()
  let failure: unknown = null
  try {
    const weekStarts = trailingWeekStarts(HISTORY_WEEKS)
    const [trendRows, history, coachingRows] = await Promise.all([
      loadRubricFailTrends(range.from, range.to, view, effectiveChannel),
      loadRubricFailTrendHistory(HISTORY_WEEKS, view, effectiveChannel),
      loadParameterCoachingList(view, effectiveChannel),
    ])
    sparklines = new Map(trendRows.map((r) => [r.parameterId, buildSparkline(r.parameterId, history, weekStarts)]))
    wow = new Map(trendRows.map((r) => [r.parameterId, weekOverWeek(r.parameterId, history, weekStarts)]))
    for (const c of coachingRows) {
      const list = coaching.get(c.parameterId) ?? []
      list.push(c)
      coaching.set(c.parameterId, list)
    }
    // Jamil's own ask: sort by decline first — the parameter that got worse the most sits on top.
    // Parameters with no comparable week (nothing scored one of the two weeks) sink to the bottom,
    // falling back to the usual worst-fail-rate-first order among themselves.
    rows = [...trendRows].sort((a, b) => {
      const da = wow.get(a.parameterId)?.trendDeltaPct ?? null
      const db = wow.get(b.parameterId)?.trendDeltaPct ?? null
      if (da === null && db === null) return b.failRatePct - a.failRatePct
      if (da === null) return 1
      if (db === null) return -1
      if (db !== da) return db - da
      return b.failRatePct - a.failRatePct
    })
  } catch (err) {
    failure = err
    if (!isMissingQaRubricTrendsSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Rubric Fail Trends</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Last week vs this week for every rubric parameter, worst decline first — and who needs coaching on each one
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
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_090_qa_rubric_trends_v2.sql</code> (after 089) and <code>supabase/schema_099_qa_parameter_coaching_list.sql</code> (after 098), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <p style={sectionNote}>
              Sorted worst decline first — the parameter that got worse the most since last sales week sits on top. &ldquo;Last week&rdquo;
              and &ldquo;This week&rdquo; are colored <span style={{ color: SEVERITY_COLOR.high, fontWeight: 600 }}>red at 40%+</span>,{' '}
              <span style={{ color: SEVERITY_COLOR.moderate, fontWeight: 600 }}>amber at 20–39%</span>, otherwise{' '}
              <span style={{ color: SEVERITY_COLOR.low, fontWeight: 600 }}>green</span>; a rate based on fewer than 10 scored audits is
              flagged &ldquo;small sample&rdquo; — treat it with caution. The last-{HISTORY_WEEKS}-weeks column shows the longer trend
              regardless of the period picked above. Click &ldquo;Needs coaching&rdquo; on any parameter to see exactly who failed it
              this sales week, worst first.
            </p>
            <RubricTrendsTable rows={rows} sparklines={sparklines} wow={wow} coaching={coaching} />
          </div>
        </>
      )}
    </div>
  )
}
