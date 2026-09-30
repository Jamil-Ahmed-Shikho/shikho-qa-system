import { BackLink } from '@/components/common/BackLink'
import { CoachingTargetForm } from '@/components/admin/qa-ranking/CoachingTargetForm'
import { isMissingQaRankingSchema, loadAuditorRanking, loadCoachingTarget, type AuditorRankingRow } from '@/lib/qa-ranking/qa-ranking.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import Link from 'next/link'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

export default async function QaAuditorRankingPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)

  let rows: AuditorRankingRow[] = []
  let coachingTarget: number | null = null
  let failure: unknown = null
  try {
    ;[rows, coachingTarget] = await Promise.all([loadAuditorRanking(range.from, range.to), loadCoachingTarget()])
  } catch (err) {
    failure = err
    if (!isMissingQaRankingSchema(err)) console.error(err)
  }
  const sorted = [...rows].sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1))

  return (
    <div>
      <BackLink href="/dashboard/admin" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Auditor Ranking</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        A fixed calculation for now — 6 percentage metrics per QA Auditor (skipped when there&apos;s nothing to measure, never
        counted as 0), averaged into one Total Score. Based on which agents are tagged to each auditor (&ldquo;QA Auditor&rdquo;
        field on their profile).
      </p>

      {!isMissingQaRankingSchema(failure) && (
        <div style={{ marginBottom: '20px' }}>
          <CoachingTargetForm current={coachingTarget} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
        {PERIOD_OPTIONS.map((p) => (
          <Link key={p.value} href={`/admin/qa-auditor-ranking?period=${p.value}`} role="tab" aria-selected={period === p.value}
            style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
            {p.label}
          </Link>
        ))}
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
      </div>

      {failure ? (
        isMissingQaRankingSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_050_qa_auditor_ranking.sql</code> (after 049), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : sorted.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          No active QA Auditors on record yet.
        </div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px' }}>
            <thead>
              <tr>
                <th style={th}>Auditor</th>
                <th style={th}>Agents</th>
                <th style={th}>Audit %</th>
                <th style={th}>Coaching %</th>
                <th style={th}>Sales Growth %</th>
                <th style={th}>Vintage Target Met %</th>
                <th style={th}>Zero-Seller Recovery %</th>
                <th style={th}>PIP Recovery %</th>
                <th style={th}>Total Score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.auditorId}>
                  <td style={td}><b>{r.auditorName}</b></td>
                  <td style={td}>{r.agentsAssigned}</td>
                  <td style={td} title={`${r.auditsDone} done of ${r.auditTarget} target`}>{pct(r.auditPct)}</td>
                  <td style={td} title={`${r.coachingCompleted} completed of ${r.coachingScheduled} scheduled${r.coachingTargetTotal !== null ? ` (target ${r.coachingTargetTotal})` : ''}`}>{pct(r.coachingPct)}</td>
                  <td style={td}>{pct(r.salesGrowthPct)}</td>
                  <td style={td}>{pct(r.vintageTargetMetPct)}</td>
                  <td style={td}>{pct(r.zeroSellerRecoveryPct)}</td>
                  <td style={td}>{pct(r.pipRecoveryPct)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{pct(r.totalScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
