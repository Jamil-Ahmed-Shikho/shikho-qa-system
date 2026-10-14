import Link from 'next/link'
import { StatTile, type StatTileAccent } from '@/components/dashboard/StatTile'
import { TodayActivityStrip } from '@/components/qa-ranking/TodayActivityStrip'
import { loadAuditorRanking, loadChannelProgress, type AuditorRankingRow } from '@/lib/qa-ranking/qa-ranking.service'
import {
  loadFatalIncidentOverview,
  loadPipLiveProgress,
  loadRygBreakdown,
  loadZeroSellerOverview,
} from '@/lib/qa-overview/qa-overview.service'
import { countReviewRequestsAwaitingDecision } from '@/lib/review-requests/review-requests.service'
import { loadOjtCandidates } from '@/lib/ojt/ojt.service'
import { periodRange } from '@/lib/dates/sales-week'

// ============================================================
// SHIKHO QA SYSTEM — Admin Dashboard live snapshot (2026-10-14). Jamil
// wanted the QA team's Daily/Weekly performance, Auditor Progress and
// Auditor's Impact Report visible on the dashboard itself, not behind a
// click. Every number here reuses an existing Team-View loader already
// proven on /reports/qa-team-progress, /reports/qa-auditor-ranking and
// /reports/qa-status-overview — this is a condensed read of the same data,
// not a new computation, so it can never disagree with those pages.
//
// Each section loads independently (Promise.allSettled, not sequential
// awaits, §14) and fails independently — a stuck query here shows "could
// not load" for just that tile/section, never blanks the whole dashboard.
// ============================================================

function pctAccent(pct: number | null): StatTileAccent {
  if (pct === null) return 'neutral'
  if (pct >= 100) return 'green'
  if (pct >= 60) return 'sunrise'
  return 'coral'
}

function scoreAccent(score: number | null): StatTileAccent {
  if (score === null) return 'neutral'
  if (score >= 80) return 'green'
  if (score >= 60) return 'sunrise'
  return 'coral'
}

function sortWorstFirst(rows: AuditorRankingRow[]): AuditorRankingRow[] {
  return [...rows].sort((a, b) => {
    if (a.totalScore === null && b.totalScore === null) return a.auditorName.localeCompare(b.auditorName)
    if (a.totalScore === null) return 1
    if (b.totalScore === null) return -1
    return a.totalScore - b.totalScore
  })
}

export async function AdminLiveSnapshot() {
  const { from, to } = periodRange('this_week')

  const [channel, auditors, ryg, zeroSeller, pip, fatals, waiting, ojt] = await Promise.allSettled([
    loadChannelProgress(from, to, 'team'),
    loadAuditorRanking(from, to, 'team'),
    loadRygBreakdown('team'),
    loadZeroSellerOverview('team'),
    loadPipLiveProgress('team'),
    loadFatalIncidentOverview(from, to, 'team'),
    countReviewRequestsAwaitingDecision(),
    loadOjtCandidates('team'),
  ])

  const waitingCount = waiting.status === 'fulfilled' ? waiting.value : null
  const reTrainingOverdue = ojt.status === 'fulfilled'
    ? ojt.value.filter((c) => c.stage === 're_training' && c.reTrainingDaysLeft !== null && c.reTrainingDaysLeft <= 0).length
    : null

  const rygCounts = ryg.status === 'fulfilled'
    ? { red: 0, yellow: 0, green: 0, unrated: 0, ...Object.fromEntries(
        ['red', 'yellow', 'green', 'unrated'].map((s) => [s, ryg.value.filter((r) => r.status === s).length])
      ) }
    : null

  return (
    <div style={{ marginBottom: '28px' }}>
      {/* Needs Attention — only shown when there's actually something waiting */}
      {((waitingCount ?? 0) > 0 || (reTrainingOverdue ?? 0) > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '18px' }}>
          {(waitingCount ?? 0) > 0 && (
            <Link href="/admin/review-requests" style={pillStyle}>
              <i className="ti ti-alert-triangle" aria-hidden style={{ fontSize: '13px' }} />
              {waitingCount} Review Request{waitingCount === 1 ? '' : 's'} waiting
            </Link>
          )}
          {(reTrainingOverdue ?? 0) > 0 && (
            <Link href="/admin/ojt" style={pillStyle}>
              <i className="ti ti-alert-triangle" aria-hidden style={{ fontSize: '13px' }} />
              {reTrainingOverdue} re-training decision{reTrainingOverdue === 1 ? '' : 's'} overdue
            </Link>
          )}
        </div>
      )}

      {/* Today */}
      <TodayActivityStrip view="team" />

      {/* This week, by channel */}
      <div style={{ marginBottom: '20px' }}>
        <SectionLabel>This week's audit progress</SectionLabel>
        {channel.status === 'rejected' ? (
          <LoadFailed />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {channel.value.map((c) => (
              <StatTile
                key={c.channel}
                label={c.channel}
                value={`${c.auditsDone}/${c.auditTarget}`}
                sub={c.auditsPct === null ? `${c.agentsCount} agents` : `${c.auditsPct}% · ${c.agentsCount} agents`}
                accent={pctAccent(c.auditsPct)}
                href="/reports/qa-team-progress"
                small
              />
            ))}
            {channel.value.length === 0 && <EmptyNote>No channels with a set target yet.</EmptyNote>}
          </div>
        )}
      </div>

      {/* Status overview */}
      <div style={{ marginBottom: '20px' }}>
        <SectionLabel>Status overview</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {rygCounts ? (
            <>
              <StatTile label="Red" value={rygCounts.red} accent="coral" href="/reports/qa-status-overview" small />
              <StatTile label="Yellow" value={rygCounts.yellow} accent="sunrise" href="/reports/qa-status-overview" small />
              <StatTile label="Green" value={rygCounts.green} accent="green" href="/reports/qa-status-overview" small />
              <StatTile label="Unrated" value={rygCounts.unrated} accent="neutral" href="/reports/qa-status-overview" small />
            </>
          ) : (
            <LoadFailed />
          )}
          <StatTile
            label="Zero-seller streaks"
            value={zeroSeller.status === 'fulfilled' ? zeroSeller.value.length : '—'}
            accent={zeroSeller.status === 'fulfilled' ? (zeroSeller.value.length > 0 ? 'coral' : 'green') : 'neutral'}
            href="/reports/qa-status-overview"
            small
          />
          <StatTile
            label="Active PIPs"
            value={pip.status === 'fulfilled' ? pip.value.length : '—'}
            accent="brand"
            href="/reports/qa-status-overview"
            small
          />
          <StatTile
            label="Fatal audits this week"
            value={fatals.status === 'fulfilled' ? fatals.value.length : '—'}
            accent={fatals.status === 'fulfilled' ? (fatals.value.length > 0 ? 'coral' : 'green') : 'neutral'}
            href="/reports/qa-status-overview"
            small
          />
        </div>
      </div>

      {/* Auditor progress & impact */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          <SectionLabel>Auditor progress &amp; impact</SectionLabel>
          <Link href="/reports/qa-auditor-ranking" style={{ fontSize: '12.5px', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
            View full report →
          </Link>
        </div>
        {auditors.status === 'rejected' ? (
          <LoadFailed />
        ) : auditors.value.length === 0 ? (
          <EmptyNote>No active QA Auditors to show yet.</EmptyNote>
        ) : (
          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
                  <th style={th}>Auditor</th>
                  <th style={th}>Audits this week</th>
                  <th style={th}>Coaching this week</th>
                  <th style={th}>Total Score</th>
                </tr>
              </thead>
              <tbody>
                {sortWorstFirst(auditors.value).map((a) => (
                  <tr key={a.auditorId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}>{a.auditorName}</td>
                    <td style={td}>{a.auditsDone}/{a.auditTarget}{a.auditPct !== null && <span style={{ color: 'var(--text-muted)' }}> · {a.auditPct}%</span>}</td>
                    <td style={td}>{a.coachingCompleted}{a.coachingTargetTotal !== null ? `/${a.coachingTargetTotal}` : ''}</td>
                    <td style={td}>
                      {a.totalScore === null ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--radius-pill)', fontWeight: 700, fontSize: '12px',
                          color: 'white', background: scoreAccent(a.totalScore) === 'green' ? 'var(--status-green)' : scoreAccent(a.totalScore) === 'sunrise' ? 'var(--highlight)' : 'var(--alert)',
                        }}>
                          {a.totalScore}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: 'var(--radius-pill)',
  background: 'var(--alert-light)', color: 'var(--alert)', fontSize: '12.5px', fontWeight: 700, textDecoration: 'none',
}

const th: React.CSSProperties = { padding: '9px 14px', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }
const td: React.CSSProperties = { padding: '10px 14px' }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 8px' }}>{children}</h3>
}

function LoadFailed() {
  return <p style={{ fontSize: '12.5px', color: 'var(--alert)', margin: 0 }}>Could not load — this does not mean there&apos;s nothing to see.</p>
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0 }}>{children}</p>
}
