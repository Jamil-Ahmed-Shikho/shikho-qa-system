import Link from 'next/link'
import { dailyMetricValue, type DailyActivityRow, type DailyMetric } from '@/lib/qa-ranking/qa-ranking.service'

export const METRIC_LABEL: Record<DailyMetric, string> = {
  audits: 'Audits', coaching: 'Coaching sessions', sampleChecks: 'Sample Checks',
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '8px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

function formatDay(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T00:00:00Z`)
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d),
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d),
  }
}

/** The day columns shown (Sat -> today), same for every auditor since the database returns a
 *  full grid (cross-join of auditors x days) — so any one auditor's day list is the full set. */
function dayList(rows: DailyActivityRow[]): string[] {
  const days = [...new Set(rows.map((r) => r.day))]
  days.sort()
  return days
}

export function DailyMetricSwitch({ metric, makeHref }: { metric: DailyMetric; makeHref: (m: DailyMetric) => string }) {
  const tab = (m: DailyMetric, label: string) => (
    <Link
      key={m}
      href={makeHref(m)}
      aria-current={metric === m ? 'page' : undefined}
      style={{
        padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)',
        borderWidth: '1px', borderStyle: 'solid', borderColor: metric === m ? 'var(--brand)' : 'var(--border)',
        background: metric === m ? 'var(--brand)' : 'transparent', color: metric === m ? '#fff' : 'inherit',
      }}
    >
      {label}
    </Link>
  )
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Which activity">
      {tab('audits', 'Audits')}
      {tab('coaching', 'Coaching')}
      {tab('sampleChecks', 'Sample Checks')}
    </div>
  )
}

/** My View — one auditor's own day-by-day bar chart, today's bar highlighted. Plain SVG, no
 *  charting dependency, same convention as this app's other sparklines/bar charts. */
export function DailyActivityChart({ rows, metric }: { rows: DailyActivityRow[]; metric: DailyMetric }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nothing recorded yet.</p>
  }
  const days = [...rows].sort((a, b) => a.day.localeCompare(b.day))
  const values = days.map((r) => dailyMetricValue(r, metric))
  const max = Math.max(1, ...values)
  const barW = 48, gap = 18, baseY = 96, chartH = 70, H = 150
  const W = days.length * (barW + gap) + gap

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${METRIC_LABEL[metric]} per day this week`} preserveAspectRatio="xMinYMin meet">
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--border)" strokeWidth={1} />
      {days.map((r, i) => {
        const v = values[i]
        const barH = Math.max(max > 0 ? (v / max) * chartH : 0, v > 0 ? 3 : 0)
        const x = gap + i * (barW + gap)
        const y = baseY - barH
        const isToday = i === days.length - 1
        const { weekday, date } = formatDay(r.day)
        return (
          <g key={r.day}>
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="12" fontWeight={600} fill="var(--text-secondary)">{v}</text>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx={5} fill={isToday ? 'var(--brand)' : 'var(--surface-2)'} />
            <text x={x + barW / 2} y={baseY + 16} textAnchor="middle" fontSize="11" fontWeight={isToday ? 700 : 400} fill={isToday ? 'var(--brand)' : 'var(--text-muted)'}>{weekday}</text>
            <text x={x + barW / 2} y={baseY + 30} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{date}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Team View — one row per auditor, one column per day (Sat -> today) plus a Total column, for
 *  the currently-selected metric. Sorted by TODAY's count ascending, so a 0-today auditor shows
 *  first, not buried at the bottom (Jamil, 2026-10-12). */
export function DailyActivityTable({ rows, metric }: { rows: DailyActivityRow[]; metric: DailyMetric }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No active QA Auditors on record yet.</p>
  }
  const days = dayList(rows)
  const byAuditor = new Map<string, DailyActivityRow[]>()
  for (const r of rows) {
    const list = byAuditor.get(r.auditorId) ?? []
    list.push(r)
    byAuditor.set(r.auditorId, list)
  }
  const auditors = [...byAuditor.entries()].map(([auditorId, dayRows]) => {
    const sorted = [...dayRows].sort((a, b) => a.day.localeCompare(b.day))
    const todayValue = dailyMetricValue(sorted[sorted.length - 1], metric)
    const total = sorted.reduce((sum, r) => sum + dailyMetricValue(r, metric), 0)
    return { auditorId, auditorName: dayRows[0].auditorName, byDay: new Map(sorted.map((r) => [r.day, r])), todayValue, total }
  })
  auditors.sort((a, b) => a.todayValue - b.todayValue || a.auditorName.localeCompare(b.auditorName))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Auditor</th>
            {days.map((d, i) => {
              const { weekday, date } = formatDay(d)
              const isToday = i === days.length - 1
              return (
                <th key={d} style={{ ...th, color: isToday ? 'var(--brand)' : th.color, textAlign: 'center' }}>
                  {weekday}<br /><span style={{ textTransform: 'none', fontWeight: 400 }}>{date}</span>
                </th>
              )
            })}
            <th style={{ ...th, textAlign: 'center' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {auditors.map((a) => (
            <tr key={a.auditorId}>
              <td style={td}><b>{a.auditorName}</b></td>
              {days.map((d, i) => {
                const isToday = i === days.length - 1
                const v = a.byDay.get(d)
                return (
                  <td key={d} style={{ ...td, textAlign: 'center', fontWeight: isToday ? 700 : 400, color: isToday && v && dailyMetricValue(v, metric) === 0 ? 'var(--alert)' : undefined }}>
                    {v ? dailyMetricValue(v, metric) : 0}
                  </td>
                )
              })}
              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{a.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
