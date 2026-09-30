import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingQaOversightSchema,
  loadReviewRequestStatusSummary,
  loadReviewRequestTeamLeadOutcomes,
  loadReviewRequestAuditorOutcomes,
  loadCalibrationSessionOverview,
  loadCalibrationConsistency,
  type ReviewRequestOpenRow,
  type TeamLeadOutcomeRow,
  type AuditorOutcomeRow,
  type CalibrationSessionRow,
  type CalibrationConsistencyRow,
} from '@/lib/qa-oversight/qa-oversight.service'
import Link from 'next/link'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '100px', textAlign: 'center' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

const STATUS_LABEL: Record<string, string> = { with_team_lead: 'With Team Lead', with_qa_manager: 'With QA Manager' }
const SESSION_STATUS_COLOR: Record<string, string> = { scheduled: 'var(--highlight)', closed: 'var(--status-green)', cancelled: 'var(--text-muted)' }

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

function OpenRequestsSection({ rows }: { rows: ReviewRequestOpenRow[] }) {
  const withTeamLead = rows.filter((r) => r.status === 'with_team_lead').length
  const withQaManager = rows.filter((r) => r.status === 'with_qa_manager').length
  return (
    <>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700 }}>{withTeamLead}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>With Team Lead</div></div>
        <div style={tile}><div style={{ fontSize: '20px', fontWeight: 700 }}>{withQaManager}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>With QA Manager</div></div>
      </div>
      {rows.length === 0 ? (
        <p style={empty}>Nothing open right now — every Review Request has been resolved.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead>
              <tr>
                <th style={th}>Agent</th>
                <th style={th}>Team / Site</th>
                <th style={th}>Filed by</th>
                <th style={th}>Status</th>
                <th style={th}>Held by</th>
                <th style={th}>Days open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.requestId}>
                  <td style={td}><b>{r.agentName}</b></td>
                  <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={td}>{r.filerRole === 'team_lead' ? 'Team Lead' : r.filerRole === 'manager' ? 'Manager' : 'Agent'}</td>
                  <td style={td}>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td style={td}>{r.heldByName ?? '—'}</td>
                  <td style={td}><span style={{ fontWeight: r.daysOpen >= 5 ? 700 : 400, color: r.daysOpen >= 5 ? 'var(--alert)' : 'inherit' }}>{r.daysOpen}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TeamLeadOutcomesSection({ rows }: { rows: TeamLeadOutcomeRow[] }) {
  if (rows.length === 0) return <p style={empty}>No Team Lead decisions in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
        <thead>
          <tr>
            <th style={th}>Team Lead</th>
            <th style={th}>Decided</th>
            <th style={th}>Upheld</th>
            <th style={th}>Escalated</th>
            <th style={th}>Upheld %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamLeadId}>
              <td style={td}><b>{r.teamLeadName}</b></td>
              <td style={td}>{r.decidedCount}</td>
              <td style={td}>{r.upheldCount}</td>
              <td style={td}>{r.escalatedCount}</td>
              <td style={td}>{r.upheldPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuditorOutcomesSection({ rows }: { rows: AuditorOutcomeRow[] }) {
  if (rows.length === 0) return <p style={empty}>No Review Requests filed against anyone's audits in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
        <thead>
          <tr>
            <th style={th}>Auditor</th>
            <th style={th}>Filed against them</th>
            <th style={th}>Resolved</th>
            <th style={th}>Revised</th>
            <th style={th}>No change</th>
            <th style={th}>Revision %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.auditorId}>
              <td style={td}><b>{r.auditorName}</b></td>
              <td style={td}>{r.filedCount}</td>
              <td style={td}>{r.resolvedCount}</td>
              <td style={td}>{r.revisedCount}</td>
              <td style={td}>{r.noChangeCount}</td>
              <td style={td}>{r.revisionPct !== null ? `${r.revisionPct}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CalibrationSessionsSection({ rows }: { rows: CalibrationSessionRow[] }) {
  if (rows.length === 0) return <p style={empty}>No calibration sessions scheduled in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
        <thead>
          <tr>
            <th style={th}>Session</th>
            <th style={th}>Team / Site</th>
            <th style={th}>When</th>
            <th style={th}>Status</th>
            <th style={th}>Participants</th>
            <th style={th}>Scores in</th>
            <th style={th}>Group mean</th>
            <th style={th}>Std. dev.</th>
            <th style={th}>Range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sessionId}>
              <td style={td}><b>{r.title}</b></td>
              <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
              <td style={td}>{formatDhakaDateTime(r.scheduledAt)}</td>
              <td style={td}><span style={{ color: SESSION_STATUS_COLOR[r.status] ?? 'inherit', fontWeight: 600 }}>{r.status}</span></td>
              <td style={td}>{r.participantsCount}</td>
              <td style={td}>{r.scoresSubmittedCount}</td>
              <td style={td}>{r.groupMeanScore !== null ? `${r.groupMeanScore}%` : '—'}</td>
              <td style={td}>{r.groupStddev !== null ? r.groupStddev : '—'}</td>
              <td style={td}>{r.scoreRange !== null ? r.scoreRange : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConsistencySection({ rows }: { rows: CalibrationConsistencyRow[] }) {
  if (rows.length === 0) return <p style={empty}>No closed calibration sessions with at least two scores in this period.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
        <thead>
          <tr>
            <th style={th}>Person</th>
            <th style={th}>Role</th>
            <th style={th}>Sessions scored</th>
            <th style={th}>Avg. deviation from group</th>
            <th style={th}>Bias (signed)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <td style={td}><b>{r.userName}</b></td>
              <td style={td}>{r.userRole}</td>
              <td style={td}>{r.sessionsScored}</td>
              <td style={td}>{r.avgAbsDeviation} pts</td>
              <td style={td}>{r.avgSignedDeviation > 0 ? `+${r.avgSignedDeviation}` : r.avgSignedDeviation} pts</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function QaOversightPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let openRequests: ReviewRequestOpenRow[] = []
  let teamLeadOutcomes: TeamLeadOutcomeRow[] = []
  let auditorOutcomes: AuditorOutcomeRow[] = []
  let calibrationSessions: CalibrationSessionRow[] = []
  let consistency: CalibrationConsistencyRow[] = []
  let failure: unknown = null
  try {
    ;[openRequests, teamLeadOutcomes, auditorOutcomes, calibrationSessions, consistency] = await Promise.all([
      loadReviewRequestStatusSummary(view),
      loadReviewRequestTeamLeadOutcomes(range.from, range.to, view),
      loadReviewRequestAuditorOutcomes(range.from, range.to, view),
      loadCalibrationSessionOverview(range.from, range.to, view),
      loadCalibrationConsistency(range.from, range.to, view),
    ])
  } catch (err) {
    failure = err
    if (!isMissingQaOversightSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Review Request Oversight &amp; Calibration Consistency</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        What&apos;s stuck, who&apos;s deciding what and how it turns out, and how consistently the team scores together.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period (outcomes and calibration only)">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/qa-oversight?period=${p.value}&view=${view}`} role="tab" aria-selected={period === p.value}
              style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && <ViewToggle view={view} base="/reports/qa-oversight" period={period} />}
      </div>

      {failure ? (
        isMissingQaOversightSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_056_qa_dashboard_stage5.sql</code> (after 055), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <h2 style={sectionTitle}>Review Requests still open</h2>
            <p style={sectionNote}>Not scoped to the period picker — always the current open list, oldest first, so nothing stuck gets lost.</p>
            <OpenRequestsSection rows={openRequests} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Team Lead decisions</h2>
            <p style={sectionNote}>How often each Team Lead upholds vs. escalates a Review Request they were the first to decide on.</p>
            <TeamLeadOutcomesSection rows={teamLeadOutcomes} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Auditor outcomes</h2>
            <p style={sectionNote}>How often each auditor&apos;s OWN original audit gets revised once it&apos;s reviewed — a direct quality signal, not how many re-audits they conducted.</p>
            <AuditorOutcomesSection rows={auditorOutcomes} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Calibration sessions</h2>
            <p style={sectionNote}>Every session in this period; the group&apos;s mean/spread only shows once a session is closed.</p>
            <CalibrationSessionsSection rows={calibrationSessions} />
          </div>

          <div style={card}>
            <h2 style={sectionTitle}>Calibration consistency</h2>
            <p style={sectionNote}>Across closed sessions: each person&apos;s average deviation from the group&apos;s own score — lower means more consistently aligned with the team.</p>
            <ConsistencySection rows={consistency} />
          </div>
        </>
      )}
    </div>
  )
}
