import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import {
  isMissingQaRankingSchema,
  loadAuditorRanking,
  loadChannelProgress,
  type AuditorRankingRow,
  type ChannelProgressRow,
  type QaRankingView,
} from '@/lib/qa-ranking/qa-ranking.service'
import { isMissingOjtSchema, loadOjtCandidates, type OjtCandidate } from '@/lib/ojt/ojt.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import Link from 'next/link'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '110px', textAlign: 'center' }

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

function AuditorProgressTable({ rows }: { rows: AuditorRankingRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nothing to show for this period.</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
        <thead>
          <tr>
            <th style={th}>Auditor</th>
            <th style={th}>Agents</th>
            <th style={th}>Audits done / target</th>
            <th style={th}>Audit %</th>
            <th style={th}>Coaching done / scheduled</th>
            <th style={th}>Coaching %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.auditorId}>
              <td style={td}><b>{r.auditorName}</b></td>
              <td style={td}>{r.agentsAssigned}</td>
              <td style={td}>{r.auditsDone} / {r.auditTarget}</td>
              <td style={td}>{pct(r.auditPct)}</td>
              <td style={td}>{r.coachingCompleted} / {r.coachingScheduled}</td>
              <td style={td}>{pct(r.coachingPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChannelTable({ rows }: { rows: ChannelProgressRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No eligible agents in scope for this period.</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Channel</th>
            <th style={th}>Agents</th>
            <th style={th}>Audits done / target</th>
            <th style={th}>Completion %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td style={td}><b>{r.channel}</b></td>
              <td style={td}>{r.agentsCount}</td>
              <td style={td}>{r.auditsDone} / {r.auditTarget}</td>
              <td style={td}>{pct(r.auditsPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OjtOverview({ candidates, failure }: { candidates: OjtCandidate[]; failure: unknown }) {
  if (failure) {
    return isMissingOjtSchema(failure) ? (
      <div role="alert" style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '13px' }}>
        <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_038_ojt_lifecycle.sql</code>, then reload.
      </div>
    ) : (
      <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px' }}>Could not be loaded right now. Try again shortly.</div>
    )
  }
  const ojt = candidates.filter((c) => c.stage === 'ojt')
  const reTraining = candidates.filter((c) => c.stage === 're_training')
  if (candidates.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody is currently in OJT or re-training.</p>
  }
  return (
    <>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
        <div style={tile}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{ojt.length}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>In OJT</div>
        </div>
        <div style={tile}>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{reTraining.length}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>In re-training</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Team / Site</th>
              <th style={th}>Stage</th>
              <th style={th}>This week&apos;s progress</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.agentId}>
                <td style={td}><b>{c.name}</b></td>
                <td style={td}>{[c.teamName, c.siteName].filter(Boolean).join(' · ') || '—'}</td>
                <td style={td}>{c.stage === 'ojt' ? 'OJT' : 'Re-training'}</td>
                <td style={td}>
                  {c.stage === 'ojt'
                    ? c.ojtTarget !== null ? `${c.ojtCallsThisWeek} / ${c.ojtTarget} calls` : `${c.ojtCallsThisWeek} calls (target not set)`
                    : c.reTrainingCallDone ? 'Required call: done' : `Required call: not yet${c.reTrainingDaysLeft !== null ? ` (${c.reTrainingDaysLeft}d left)` : ''}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default async function QaTeamProgressPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let auditorRows: AuditorRankingRow[] = []
  let channelRows: ChannelProgressRow[] = []
  let rankingFailure: unknown = null
  try {
    ;[auditorRows, channelRows] = await Promise.all([
      loadAuditorRanking(range.from, range.to, view),
      loadChannelProgress(range.from, range.to, view),
    ])
  } catch (err) {
    rankingFailure = err
    if (!isMissingQaRankingSchema(err)) console.error(err)
  }

  let ojtCandidates: OjtCandidate[] = []
  let ojtFailure: unknown = null
  try {
    ojtCandidates = await loadOjtCandidates()
  } catch (err) {
    ojtFailure = err
    if (!isMissingOjtSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>This Week&apos;s QA Progress</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Audit and coaching progress per auditor, channel-wise audit target vs. completion, and who&apos;s currently in
        OJT or re-training.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-team-progress?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} base="/reports/qa-team-progress" period={period} />}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Per-auditor progress</h2>
        <p style={sectionNote}>Audit and coaching completion against target, for the selected period.</p>
        {rankingFailure ? (
          isMissingQaRankingSchema(rankingFailure) ? (
            <div role="alert" style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '13px' }}>
              <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_050_qa_auditor_ranking.sql</code> (after 049), then reload.
            </div>
          ) : (
            <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px' }}>Could not be loaded right now. Try again shortly.</div>
          )
        ) : (
          <AuditorProgressTable rows={auditorRows} />
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Channel-wise audit target vs. completion</h2>
        <p style={sectionNote}>Telesales, CX, Retention, TS3P etc. — OJT is broken out as its own group, not folded into an agent&apos;s team.</p>
        {rankingFailure ? null : <ChannelTable rows={channelRows} />}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>OJT / Re-training pipeline</h2>
        <p style={sectionNote}>Always the current week, company-wide — not affected by the period picker above.</p>
        <OjtOverview candidates={ojtCandidates} failure={ojtFailure} />
      </div>
    </div>
  )
}
