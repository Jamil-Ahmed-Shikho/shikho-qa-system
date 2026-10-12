import Link from 'next/link'
import { dailyMetricValue, isMissingQaRankingSchema, loadDailyActivity, type QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

const tile: React.CSSProperties = {
  background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '8px 16px', minWidth: '96px', textAlign: 'center',
}

/** A compact "how's today going" glance — audits/coaching/Sample Checks done TODAY, with a link
 *  to the full day-by-day breakdown. Deliberately minimal (no chart, no metric switch) — that
 *  detail lives on /reports/qa-team-progress's Daily tab; this is just the quick pulse on the
 *  QA Auditor's own dashboard. A load failure is swallowed quietly (supplementary info, same
 *  treatment QueueSection already gives its own re-training supplement). */
export async function TodayActivityStrip({ view }: { view: QaRankingView }) {
  try {
    const rows = await loadDailyActivity(view)
    if (rows.length === 0) return null
    const lastDay = [...rows].sort((a, b) => a.day.localeCompare(b.day)).at(-1)!.day
    const today = rows.filter((r) => r.day === lastDay)
    const sum = (m: Parameters<typeof dailyMetricValue>[1]) => today.reduce((s, r) => s + dailyMetricValue(r, m), 0)

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={tile}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{sum('audits')}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Audits today</div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{sum('coaching')}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Coaching today</div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{sum('sampleChecks')}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sample Checks today</div>
        </div>
        <Link href={`/reports/qa-team-progress?tab=daily&view=${view}`} style={{ fontSize: '13px', color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>
          See day-by-day →
        </Link>
      </div>
    )
  } catch (err) {
    if (!isMissingQaRankingSchema(err)) console.error('TodayActivityStrip failed:', err)
    return null
  }
}
