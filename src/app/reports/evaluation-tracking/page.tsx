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
  summarizeEvaluationTracking,
  UNASSIGNED_ID,
  type EvaluationTrackingRow,
  type EvaluationTrackingSummaryRow,
} from '@/lib/audits/evaluation-tracking.service'

/** Not yet viewed, and old enough that it's worth flagging rather than just "still fresh". */
const STALE_DAYS = 3

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 2px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }
const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '130px', textAlign: 'center' }

function ViewToggle({ view, qs }: { view: QaRankingView; qs: (extra?: Record<string, string>) => string }) {
  const tab = (v: QaRankingView, text: string) => (
    <Link href={qs({ view: v })} aria-current={view === v ? 'page' : undefined} style={pill(view === v)}>
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

/** Completion-rate coloring — the opposite sense of a fail rate: high is good here. Not specified,
 *  a reasonable default (mirrors failRateSeverity's own 3-tier split elsewhere in this app). */
function viewedPctColor(pct: number): string {
  if (pct >= 70) return 'var(--status-green)'
  if (pct >= 40) return 'var(--highlight)'
  return 'var(--alert)'
}

/** The QA-wise / Team-Lead-wise breakdown — always shows EVERYONE regardless of the active qa/tl
 *  filter (it's the index you pick a filter FROM), sorted worst-stale-first. Clicking a row sets
 *  (or, if already selected, clears) that filter; the other filter param is preserved. */
function SummaryTable({
  title, note, rows, paramName, selectedId, qs,
}: {
  title: string
  note: string
  rows: EvaluationTrackingSummaryRow[]
  paramName: 'qa' | 'tl'
  selectedId: string | null
  qs: (extra?: Record<string, string>) => string
}) {
  return (
    <div style={card}>
      <p style={sectionTitle}>{title}</p>
      <p style={sectionNote}>{note}</p>
      {rows.length === 0 ? <p style={empty}>Nothing in this period.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
            <thead>
              <tr>
                <th style={th}>{paramName === 'qa' ? 'QA Auditor' : 'Team Lead'}</th>
                <th style={th}>Sent</th><th style={th}>Viewed</th><th style={th}>Stale</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const isSelected = selectedId === s.id
                const href = qs({ [paramName]: isSelected ? '' : s.id })
                return (
                  <tr key={s.id} style={isSelected ? { background: 'var(--brand-light)' } : undefined}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                    <td style={td}>{s.sent}</td>
                    <td style={td}><span style={{ fontWeight: 600, color: viewedPctColor(s.viewedPct) }}>{s.viewedPct}%</span> <span style={{ color: 'var(--text-muted)' }}>({s.viewed})</span></td>
                    <td style={td}>{s.stale > 0 ? <span style={{ fontWeight: 700, color: 'var(--alert)' }}>{s.stale}</span> : 0}</td>
                    <td style={td}>
                      <Link href={href} prefetch={false} style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--brand)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        {isSelected ? 'Clear ✕' : 'View emails →'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default async function EvaluationTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; view?: string; qa?: string; tl?: string }>
}) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const isTeamLead = user?.role === 'team_lead'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'
  const qaFilter = sp.qa || null
  const tlFilter = sp.tl || null

  // Builds a link to this same page, keeping period/view/qa/tl unless overridden — '' clears a param.
  const qs = (extra?: Record<string, string>) => {
    const params = new URLSearchParams()
    params.set('period', period)
    params.set('view', view)
    if (qaFilter) params.set('qa', qaFilter)
    if (tlFilter) params.set('tl', tlFilter)
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v === '') params.delete(k)
      else params.set(k, v)
    }
    return `/reports/evaluation-tracking?${params.toString()}`
  }

  let rows: EvaluationTrackingRow[] = []
  let failure: unknown = null
  try {
    rows = await loadEvaluationTrackingReport(range.from, range.to, view)
  } catch (err) {
    failure = err
    if (!isMissingEvaluationTrackingSchema(err)) console.error(err)
  }

  // Overview tiles stay overall (unfiltered) — the summary tables below already show each QA/TL's
  // own aggregate, so the tiles don't need to re-show the same numbers; only the detail list
  // narrows when a filter is picked.
  const viewedCount = rows.filter((r) => r.viewedAt).length
  const staleCount = rows.filter((r) => !r.viewedAt && daysSince(r.submittedAt) >= STALE_DAYS).length
  const viewedPct = rows.length > 0 ? Math.round((viewedCount / rows.length) * 100) : null

  const byAuditor = summarizeEvaluationTracking(rows, (r) => ({ id: r.auditorId, name: r.auditorName }), STALE_DAYS)
  const byTeamLead = summarizeEvaluationTracking(rows, (r) => ({ id: r.teamLeaderId, name: r.teamLeaderName }), STALE_DAYS)

  const detailRows = rows.filter((r) => {
    if (qaFilter && (r.auditorId ?? UNASSIGNED_ID) !== qaFilter) return false
    if (tlFilter && (r.teamLeaderId ?? UNASSIGNED_ID) !== tlFilter) return false
    return true
  })
  const selectedAuditorName = qaFilter ? (byAuditor.find((s) => s.id === qaFilter)?.name ?? null) : null
  const selectedTlName = tlFilter ? (byTeamLead.find((s) => s.id === tlFilter)?.name ?? null) : null

  // "By QA Auditor" is pointless in My View (a qa_auditor there only ever sees their own one row);
  // "By Team Lead" is pointless for a Team Lead themselves (every row's Team Lead is just them).
  const showAuditorSummary = !(isAuditor && view === 'mine')
  const showTeamLeadSummary = !isTeamLead

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
            <Link key={p.value} href={qs({ period: p.value })} role="tab" aria-selected={period === p.value} style={pill(period === p.value)}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} qs={qs} />}
      </div>

      {failure ? (
        isMissingEvaluationTrackingSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_092_audit_result_views.sql</code> (after 091) through <code>supabase/schema_102_evaluation_tracking_ids.sql</code> (after 101), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{rows.length}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Emails sent</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{viewedPct !== null ? `${viewedPct}%` : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Viewed</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700, color: staleCount > 0 ? 'var(--alert)' : 'inherit' }}>{staleCount}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stale ({STALE_DAYS}+ days, unseen)</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: showAuditorSummary && showTeamLeadSummary ? 'repeat(auto-fit, minmax(380px, 1fr))' : '1fr', gap: '0 20px' }}>
            {showAuditorSummary && (
              <SummaryTable title="By QA Auditor" note="Worst (most stale) first. Click a name to see just their emails below." rows={byAuditor} paramName="qa" selectedId={qaFilter} qs={qs} />
            )}
            {showTeamLeadSummary && (
              <SummaryTable title="By Team Lead" note="Worst (most stale) first. Click a name to see just their team's emails below." rows={byTeamLead} paramName="tl" selectedId={tlFilter} qs={qs} />
            )}
          </div>

          <div style={card}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <p style={{ ...sectionNote, margin: 0 }}>Sorted newest first{(qaFilter || tlFilter) ? ` — ${detailRows.length} of ${rows.length}` : ''}.</p>
              {qaFilter && (
                <Link href={qs({ qa: '' })} prefetch={false} style={{ ...pill(true), fontSize: '12px', padding: '4px 10px' }}>
                  QA: {selectedAuditorName ?? 'Unassigned'} ✕
                </Link>
              )}
              {tlFilter && (
                <Link href={qs({ tl: '' })} prefetch={false} style={{ ...pill(true), fontSize: '12px', padding: '4px 10px' }}>
                  TL: {selectedTlName ?? 'Unassigned'} ✕
                </Link>
              )}
            </div>
            {detailRows.length === 0 ? <p style={empty}>{rows.length === 0 ? 'No evaluation emails in this period.' : 'No emails match this filter.'}</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                  <thead>
                    <tr>
                      <th style={th}>Agent</th><th style={th}>Team / Site</th><th style={th}>QA Auditor</th><th style={th}>Sent</th><th style={th}>Status</th><th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((r) => (
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
