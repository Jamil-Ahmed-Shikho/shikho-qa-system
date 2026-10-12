import { BackLink } from '@/components/common/BackLink'
import { CoachingTargetForm } from '@/components/admin/qa-ranking/CoachingTargetForm'
import { ImpactWeightsForm } from '@/components/admin/qa-ranking/ImpactWeightsForm'
import { getAuthUser } from '@/lib/auth/auth.service'
import {
  isMissingQaRankingSchema, loadAuditorRanking, loadCoachingTarget, loadImpactWeights,
  type AuditorRankingRow, type QaRankingView,
} from '@/lib/qa-ranking/qa-ranking.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import Link from 'next/link'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

const STATUS_BANDS: { min: number; label: string; color: string }[] = [
  { min: 90, label: 'Outstanding', color: 'var(--status-green)' },
  { min: 80, label: 'Excellent', color: 'var(--status-green)' },
  { min: 70, label: 'Good', color: 'var(--brand)' },
  { min: 60, label: 'Needs Improvement', color: 'var(--highlight)' },
  { min: -Infinity, label: 'Critical', color: 'var(--alert)' },
]
function impactStatus(score: number | null): { label: string; color: string } | null {
  if (score === null) return null
  return STATUS_BANDS.find((b) => score >= b.min) ?? null
}

function MiniBar({ value, color }: { value: number | null; color?: string }) {
  if (value === null) return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>
  const width = Math.max(0, Math.min(100, value))
  const barColor = color ?? (value >= 90 ? 'var(--status-green)' : value >= 70 ? 'var(--brand)' : value >= 50 ? 'var(--highlight)' : 'var(--alert)')
  return (
    <div style={{ width: '88px' }}>
      <div style={{ height: '6px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${width}%`, background: barColor, borderRadius: 'var(--radius-pill)' }} />
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{value}%</div>
    </div>
  )
}

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

export default async function QaAuditorRankingPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let rows: AuditorRankingRow[] = []
  let coachingTarget: number | null = null
  let impactWeights: Awaited<ReturnType<typeof loadImpactWeights>> = null
  let failure: unknown = null
  try {
    rows = await loadAuditorRanking(range.from, range.to, view)
    if (!isAuditor) {
      coachingTarget = await loadCoachingTarget()
      impactWeights = await loadImpactWeights()
    }
  } catch (err) {
    failure = err
    if (!isMissingQaRankingSchema(err)) console.error(err)
  }
  const sorted = [...rows].sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1))

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Auditor&apos;s Impact Report</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '740px' }}>
        A weighted Total Score per QA Auditor, from six metrics — a metric with nothing to measure this period is
        skipped entirely (never counted as 0), and the remaining weights are shared out among whatever does apply.
        Based on which agents are tagged to each auditor (&ldquo;QA Auditor&rdquo; field on their profile).
        <b> PIP Recovery</b> is shown separately, for the current calendar month only, since a PIP only really
        resolves at month-end — it is not part of the Total Score.
      </p>

      {!isMissingQaRankingSchema(failure) && !isAuditor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
            <CoachingTargetForm current={coachingTarget} />
          </div>
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
            <ImpactWeightsForm current={impactWeights} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-auditor-ranking?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} base="/reports/qa-auditor-ranking" period={period} />}
      </div>

      {failure ? (
        isMissingQaRankingSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_093_qa_auditor_impact_report.sql</code> (after 092), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : sorted.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          {isAuditor && view === 'mine' ? 'You are not marked active as a QA Auditor, or nothing has been recorded for you yet.' : 'No active QA Auditors on record yet.'}
        </div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1180px' }}>
            <thead>
              <tr>
                <th style={th}>Auditor</th>
                <th style={th}>Agents</th>
                <th style={th}>Audit %</th>
                <th style={th}>Coaching %</th>
                <th style={th}>Sales Growth %</th>
                <th style={th}>Vintage Target Met %</th>
                <th style={th}>Agent Recovery %</th>
                <th style={th}>Zero-Seller Recovery %</th>
                <th style={th}>PIP Recovery % (this month)</th>
                <th style={th}>Total Score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const status = impactStatus(r.totalScore)
                return (
                  <tr key={r.auditorId}>
                    <td style={td}><b>{r.auditorName}</b></td>
                    <td style={td}>{r.agentsAssigned}</td>
                    <td style={td} title={`${r.auditsDone} done of ${r.auditTarget} target`}>{pct(r.auditPct)}</td>
                    <td style={td} title={`${r.coachingCompleted} completed of ${r.coachingScheduled} scheduled${r.coachingTargetTotal !== null ? ` (target ${r.coachingTargetTotal})` : ''}`}>{pct(r.coachingPct)}</td>
                    <td style={td}>{pct(r.salesGrowthPct)}</td>
                    <td style={td} title="Vintage-wise weekly USD revenue target — total revenue vs. total target across the period">{pct(r.vintageTargetMetPct)}</td>
                    <td style={td} title="Of agents Red/Yellow just before the period, who's since recovered to Green">{pct(r.agentRecoveryPct)}</td>
                    <td style={td}>{pct(r.zeroSellerRecoveryPct)}</td>
                    <td style={td} title={r.pipConcludedThisMonth > 0 ? `${r.pipConcludedThisMonth} PIP(s) concluded this month` : 'No PIP has concluded this month yet'}>{pct(r.pipRecoveryPct)}</td>
                    <td style={{ ...td, whiteSpace: 'normal' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <MiniBar value={r.totalScore} color={status?.color} />
                        {status && (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: status.color, whiteSpace: 'nowrap' }}>{status.label}</span>
                        )}
                      </div>
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
