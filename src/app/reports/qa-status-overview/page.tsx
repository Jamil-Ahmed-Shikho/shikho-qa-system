import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatUsd } from '@/lib/money/usd'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingQaOverviewSchema,
  loadRygBreakdown,
  loadZeroSellerOverview,
  loadFatalIncidentOverview,
  loadPipHistorySummary,
  loadPipLiveProgress,
  type RygBreakdownRow,
  type RygStatus,
  type ZeroSellerRow,
  type FatalIncidentRow,
  type PipHistoryRow,
  type PipLiveProgressRow,
} from '@/lib/qa-overview/qa-overview.service'
import Link from 'next/link'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '100px', textAlign: 'center' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

const RYG_COLOR: Record<RygStatus, string> = { red: 'var(--alert)', yellow: 'var(--highlight)', green: 'var(--status-green)', unrated: 'var(--text-muted)' }
const RYG_LABEL: Record<RygStatus, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', unrated: 'Unrated' }

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

function RygSection({ rows }: { rows: RygBreakdownRow[] }) {
  const counts: Record<RygStatus, number> = { red: 0, yellow: 0, green: 0, unrated: 0 }
  for (const r of rows) counts[r.status]++
  const sorted = rows.filter((r) => r.status !== 'green')
  return (
    <>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {(['red', 'yellow', 'green', 'unrated'] as RygStatus[]).map((s) => (
          <div key={s} style={tile}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: RYG_COLOR[s] }}>{counts[s]}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{RYG_LABEL[s]}</div>
          </div>
        ))}
      </div>
      {sorted.length === 0 ? (
        <p style={empty}>Nobody is Red, Yellow or Unrated right now — everyone in scope is Green.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr>
                <th style={th}>Agent</th>
                <th style={th}>Team / Site</th>
                <th style={th}>Status</th>
                <th style={th}>Avg score (4wk)</th>
                <th style={th}>Critical fatals</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.agentId}>
                  <td style={td}><b>{r.agentName}</b></td>
                  <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={td}><span style={{ color: RYG_COLOR[r.status], fontWeight: 600 }}>{RYG_LABEL[r.status]}</span></td>
                  <td style={td}>{r.avgAuditScore !== null ? `${r.avgAuditScore}%` : '—'}</td>
                  <td style={td}>{r.criticalFatalCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function ZeroSellerSection({ rows }: { rows: ZeroSellerRow[] }) {
  if (rows.length === 0) return <p style={empty}>Nobody currently has an active zero-seller streak.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Agent</th>
            <th style={th}>Team / Site</th>
            <th style={th}>Streak (weeks)</th>
            <th style={th}>Since</th>
            <th style={th}>Last sale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId}>
              <td style={td}><b>{r.agentName}</b></td>
              <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
              <td style={td}>{r.currentStreakWeeks}</td>
              <td style={td}>{r.streakStartWeek ?? '—'}</td>
              <td style={td}>{r.lastSaleDate ?? 'None on record'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FatalSection({ rows }: { rows: FatalIncidentRow[] }) {
  if (rows.length === 0) return <p style={empty}>No critical-fatal audits in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
        <thead>
          <tr>
            <th style={th}>Agent</th>
            <th style={th}>Team / Site</th>
            <th style={th}>Auditor</th>
            <th style={th}>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.auditId}>
              <td style={td}><b>{r.agentName}</b></td>
              <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
              <td style={td}>{r.auditorName ?? '—'}</td>
              <td style={td}>{formatDhakaDateTime(r.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PipHistorySection({ rows }: { rows: PipHistoryRow[] }) {
  if (rows.length === 0) return <p style={empty}>No PIP cycles on record yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Cycle (month)</th>
            <th style={th}>Suggested</th>
            <th style={th}>Excluded</th>
            <th style={th}>Approved</th>
            <th style={th}>Completed</th>
            <th style={th}>Failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cycleId}>
              <td style={td}><b>{r.month}</b></td>
              <td style={td}>{r.suggestedCount}</td>
              <td style={td}>{r.excludedCount}</td>
              <td style={td}>{r.approvedCount}</td>
              <td style={td}>{r.completedCount}</td>
              <td style={td}>{r.failedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PipLiveSection({ rows }: { rows: PipLiveProgressRow[] }) {
  if (rows.length === 0) return <p style={empty}>No PIP cycle is currently running, or nobody is on it in scope.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
        <thead>
          <tr>
            <th style={th}>Agent</th>
            <th style={th}>Team Lead</th>
            <th style={th}>Site</th>
            <th style={th}>Auditor</th>
            <th style={th}>Target</th>
            <th style={th}>Achieved so far</th>
            <th style={th}>Days left</th>
            <th style={th}>Run rate still needed / day</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agentId}>
              <td style={td}><b>{r.agentName}</b></td>
              <td style={td}>{r.teamLeaderName ?? '—'}</td>
              <td style={td}>{r.siteName ?? '—'}</td>
              <td style={td}>{r.auditorName ?? '—'}</td>
              <td style={td}>{formatUsd(r.targetUsd)}</td>
              <td style={td}>{formatUsd(r.achievedUsd)}</td>
              <td style={td}>{r.daysLeft}</td>
              <td style={td}>
                {r.targetMet ? <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>Target met</span>
                  : r.runRateRequiredUsdPerDay !== null ? formatUsd(r.runRateRequiredUsdPerDay) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function QaStatusOverviewPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let ryg: RygBreakdownRow[] = []
  let zeroSeller: ZeroSellerRow[] = []
  let fatals: FatalIncidentRow[] = []
  let pipHistory: PipHistoryRow[] = []
  let pipLive: PipLiveProgressRow[] = []
  let failure: unknown = null
  try {
    ;[ryg, zeroSeller, fatals, pipHistory, pipLive] = await Promise.all([
      loadRygBreakdown(view),
      loadZeroSellerOverview(view),
      loadFatalIncidentOverview(range.from, range.to, view),
      loadPipHistorySummary(view),
      loadPipLiveProgress(view),
    ])
  } catch (err) {
    failure = err
    if (!isMissingQaOverviewSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>RYG, PIP, Zero-Seller &amp; Fatal-Incident Overview</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Who&apos;s Red/Yellow/Green right now, who&apos;s on an active zero-seller streak, who&apos;s currently on a PIP
        and how they&apos;re tracking against target, and every critical-fatal audit in the selected period.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period (fatal incidents only)">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-status-overview?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)} (fatal incidents)</span>
        </div>
        {isAuditor && <ViewToggle view={view} base="/reports/qa-status-overview" period={period} />}
      </div>

      {failure ? (
        isMissingQaOverviewSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_054_qa_dashboard_stage3.sql</code> (after 053), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <h2 style={sectionTitle}>RYG breakdown</h2>
            <p style={sectionNote}>Current status per agent (rolling 4-week window, §6.2) — Green agents are counted but not listed, to keep the list focused on who needs attention.</p>
            <RygSection rows={ryg} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Zero-Seller overview</h2>
            <p style={sectionNote}>Everyone currently on an active zero-seller streak, longest first.</p>
            <ZeroSellerSection rows={zeroSeller} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>PIP overview — current cycle, live progress</h2>
            <p style={sectionNote}>Who&apos;s on a PIP right now and how they&apos;re tracking: target, achieved so far, days left in the cycle, and the daily run rate still needed to hit target.</p>
            <PipLiveSection rows={pipLive} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>PIP overview — historic reference</h2>
            <p style={sectionNote}>Suggested/excluded/approved/completed/failed counts per cycle, most recent first.</p>
            <PipHistorySection rows={pipHistory} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Fatal-incident overview</h2>
            <p style={sectionNote}>Every critical-fatal audit submitted in the selected period.</p>
            <FatalSection rows={fatals} />
          </div>
        </>
      )}
    </div>
  )
}
