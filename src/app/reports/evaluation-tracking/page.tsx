import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { StatusChip } from '@/components/common/StatusChip'
import {
  daysSince,
  isMissingEvaluationTrackingSchema,
  loadEvaluationTrackingReport,
  type EvaluationTrackingRow,
} from '@/lib/audits/evaluation-tracking.service'

/** Not yet viewed, and old enough that it's worth flagging rather than just "still fresh". */
const STALE_DAYS = 3

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }
const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '130px', textAlign: 'center' }

function ViewToggle({ view, period }: { view: QaRankingView; period: string }) {
  const tab = (v: QaRankingView, text: string) => (
    <Link href={`/reports/evaluation-tracking?period=${period}&view=${v}`} aria-current={view === v ? 'page' : undefined} style={pill(view === v)}>
      {text}
    </Link>
  )
  return <div style={{ display: 'flex', gap: '8px' }}>{tab('mine', 'My view')}{tab('team', 'Team view')}</div>
}

function ViewedCell({ r }: { r: EvaluationTrackingRow }) {
  if (r.viewedAt) {
    return (
      <div>
        <StatusChip tone="success">Viewed</StatusChip>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
          {formatDhakaDateTime(r.viewedAt)}{r.viewCount > 1 ? ` · opened ${r.viewCount}×` : ''}
        </div>
      </div>
    )
  }
  const days = daysSince(r.submittedAt)
  return days >= STALE_DAYS
    ? <StatusChip tone="alert" title={`Sent ${days} days ago, not yet viewed`}>Not yet viewed · {days}d</StatusChip>
    : <StatusChip tone="neutral">Not yet viewed</StatusChip>
}

export default async function EvaluationTrackingPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let rows: EvaluationTrackingRow[] = []
  let failure: unknown = null
  try {
    rows = await loadEvaluationTrackingReport(range.from, range.to, view)
  } catch (err) {
    failure = err
    if (!isMissingEvaluationTrackingSchema(err)) console.error(err)
  }

  const viewedCount = rows.filter((r) => r.viewedAt).length
  const staleCount = rows.filter((r) => !r.viewedAt && daysSince(r.submittedAt) >= STALE_DAYS).length
  const viewedPct = rows.length > 0 ? Math.round((viewedCount / rows.length) * 100) : null

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Evaluation Email Tracking</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Whether an agent has clicked through to their result email — a real click, not a tracking
        pixel (those are unreliable: many mail apps auto-load images whether a human looks or not).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/evaluation-tracking?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value} style={pill(period === p.value)}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} period={period} />}
      </div>

      {failure ? (
        isMissingEvaluationTrackingSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_092_audit_result_views.sql</code> (after 091), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{rows.length}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Emails sent</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{viewedPct !== null ? `${viewedPct}%` : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Viewed</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700, color: staleCount > 0 ? 'var(--alert)' : 'inherit' }}>{staleCount}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stale ({STALE_DAYS}+ days, unseen)</div></div>
          </div>

          <div style={card}>
            <p style={sectionNote}>Sorted newest first.</p>
            {rows.length === 0 ? <p style={empty}>No evaluation emails in this period.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                  <thead>
                    <tr>
                      <th style={th}>Agent</th><th style={th}>Team / Site</th><th style={th}>QA Auditor</th><th style={th}>Sent</th><th style={th}>Status</th><th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.auditId}>
                        <td style={td}>
                          <b>{r.agentName}</b>
                          {r.teamLeaderName && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>TL: {r.teamLeaderName}</div>}
                        </td>
                        <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                        <td style={td}>{r.auditorName ?? '—'}</td>
                        <td style={td}>{formatDhakaDateTime(r.submittedAt)}</td>
                        <td style={td}><ViewedCell r={r} /></td>
                        <td style={td}><Link href={`/audits/${r.auditId}`} prefetch={false} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>View audit →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
