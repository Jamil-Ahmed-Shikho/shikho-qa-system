import Link from 'next/link'
import { formatUsd } from '@/lib/money/usd'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { TeamLeadDashboard } from '@/lib/team-lead/team-lead-dashboard.service'
import { StatusChip } from '@/components/common/StatusChip'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'

// ============================================================
// Reorganized 2026-10-12 (Team Lead portal standardization, Jamil's own
// request after reviewing outside UX feedback — see the conversation for
// which of those suggestions were adopted vs dropped and why). Page order
// is now: KPI metric cards -> "Needs your attention" strip -> Quick Actions
// -> Academic Counselor Performance table -> collapsible detail sections
// (Fatal/Zero-Seller/PIP/Review Requests/Recent Audits) -> Calibration/
// Coaching (unchanged, rendered by the page below this component). Plain
// colored text for a status is now a tinted StatusChip; the five detail
// sections collapse so the page isn't one forced scroll.
// ============================================================

/** Every agent name on this dashboard links to their profile (/audits/agent/[agentId]/profile,
 * already reachable for team_lead — same page a QA Auditor opens from QueueSection's "Who to
 * audit next," §9 Part 2) — a Claude-made call, extending that 2026-10-03 feature here too since
 * it was a plain oversight that this dashboard never got it in the first place, not a decision to leave it out. */
function AgentLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/audits/agent/${id}/profile`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>{name}</Link>
}

/** Opens exactly this one audit — distinct from AgentLink, which opens the agent's whole profile
 * (every audit). Added 2026-10-11 per Jamil's own feedback: a Team Lead reading "Fatal incidents"
 * or "Recent audits" shouldn't have to search the full profile for the one audit the row is about. */
function AuditLink({ id }: { id: string }) {
  return <Link href={`/audits/${id}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>View audit →</Link>
}

const kpiCard: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 18px', minWidth: '140px', flex: '1 1 140px', borderTop: '3px solid var(--brand)' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

const STATUS_LABEL: Record<string, string> = { with_team_lead: 'With you', with_qa_manager: 'With QA Manager' }

const KPI_ACCENT: Record<string, string> = {
  agents: 'var(--brand)', target: 'var(--brand)', coverage: 'var(--highlight)', score: 'var(--status-green)', pass: 'var(--status-green)',
}

function Kpi({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div style={{ ...kpiCard, borderTopColor: accent }}>
      <div style={{ fontSize: '22px', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

/** A short-order summary of what genuinely needs the Team Lead's attention right now, pulled from
 *  data already loaded for the sections below (no extra query) — jump links scroll straight to the
 *  relevant section, which (per the defaultOpen rule below) is already expanded when it has anything
 *  in it. Today's coaching is deliberately NOT duplicated here — the Coaching section further down
 *  already has its own clear Today/Tomorrow tiles; re-fetching that here would mean a second,
 *  redundant query for the same data (§14). */
function AttentionStrip({ data }: { data: TeamLeadDashboard }) {
  const fatalCount = data.fatalIncidents.length
  const staleReviews = data.openReviewRequests.filter((r) => r.daysOpen >= 5).length

  if (fatalCount === 0 && staleReviews === 0) {
    return (
      <div style={{ background: 'var(--status-green-light)', border: '1px solid var(--status-green)', borderRadius: 'var(--radius-md)', padding: '12px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--status-green)', fontWeight: 700 }}>✓</span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nothing urgent right now — no critical fatals this period, no review request waiting 5+ days.</span>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-md)', padding: '14px 18px', marginBottom: '20px' }}>
      <h2 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 10px', color: 'var(--text-primary)' }}>Needs your attention</h2>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        {fatalCount > 0 && (
          <a href="#fatal-incidents" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
            <StatusChip tone="alert">{fatalCount} critical fatal{fatalCount === 1 ? '' : 's'}</StatusChip>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>this period →</span>
          </a>
        )}
        {staleReviews > 0 && (
          <a href="#review-requests" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
            <StatusChip tone="warning">{staleReviews} review request{staleReviews === 1 ? '' : 's'}</StatusChip>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>open 5+ days →</span>
          </a>
        )}
      </div>
    </div>
  )
}

function PipProgressBar({ achievedUsd, targetUsd, met }: { achievedUsd: number; targetUsd: number | null; met: boolean | null }) {
  if (targetUsd === null) return <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No target set</span>
  const pct = targetUsd > 0 ? Math.min(100, Math.round((achievedUsd / targetUsd) * 100)) : met ? 100 : 0
  const color = met ? 'var(--status-green)' : pct >= 50 ? 'var(--highlight)' : 'var(--alert)'
  return (
    <div style={{ width: '120px' }}>
      <div style={{ height: '6px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 'var(--radius-pill)' }} />
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{pct}%</div>
    </div>
  )
}

export function TeamLeadDashboardView({ data, agentPerformance, quickActions }: { data: TeamLeadDashboard; agentPerformance?: React.ReactNode; quickActions?: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <Kpi value={String(data.agentCount)} label="Agents" accent={KPI_ACCENT.agents} />
        <Kpi value={`${data.auditsDone} / ${data.auditTarget}`} label="Audits vs target" accent={KPI_ACCENT.target} />
        <Kpi value={data.auditPct !== null ? `${data.auditPct}%` : '—'} label="Coverage" accent={KPI_ACCENT.coverage} />
        <Kpi value={data.avgScore !== null ? `${data.avgScore}%` : '—'} label="Avg score" accent={KPI_ACCENT.score} />
        <Kpi value={data.passRate !== null ? `${data.passRate}%` : '—'} label="Pass rate" accent={KPI_ACCENT.pass} />
      </div>

      <AttentionStrip data={data} />

      {quickActions}

      {agentPerformance}

      <CollapsibleSection
        id="fatal-incidents"
        title="Fatal incidents"
        subtitle="Every critical-fatal audit on your team in this period."
        defaultOpen={data.fatalIncidents.length > 0}
        badge={data.fatalIncidents.length > 0 ? <StatusChip tone="alert">{data.fatalIncidents.length}</StatusChip> : undefined}
      >
        {data.fatalIncidents.length === 0 ? <p style={empty}>None in this period.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Fatal item(s)</th><th style={th}>Auditor</th><th style={th}>Submitted</th><th style={th}>Lifetime fatals</th><th style={th}></th></tr></thead>
              <tbody>
                {data.fatalIncidents.map((f) => (
                  <tr key={f.auditId}>
                    <td style={td}><AgentLink id={f.agentId} name={f.agentName} /></td>
                    <td style={{ ...td, whiteSpace: 'normal', minWidth: '220px' }}>
                      {f.fatalParameters.length === 0 ? '—' : f.fatalParameters.join('; ')}
                    </td>
                    <td style={td}>{f.auditorName ?? '—'}</td>
                    <td style={td}>{formatDhakaDateTime(f.submittedAt)}</td>
                    <td style={td}>
                      {f.lifetimeFatalCount >= 2 ? <StatusChip tone="alert">{f.lifetimeFatalCount} lifetime</StatusChip> : f.lifetimeFatalCount}
                    </td>
                    <td style={td}><AuditLink id={f.auditId} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="zero-seller"
        title="Zero-Seller"
        subtitle="Anyone on your team currently on an active zero-seller streak."
        defaultOpen={data.zeroSellers.length > 0}
        badge={data.zeroSellers.length > 0 ? <StatusChip tone="warning">{data.zeroSellers.length}</StatusChip> : undefined}
      >
        {data.zeroSellers.length === 0 ? <p style={empty}>Nobody on your team is a zero-seller right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Vintage</th><th style={th}>Streak (weeks)</th><th style={th}>Last sale</th><th style={th}>Days since</th><th style={th}>Revenue that day</th></tr></thead>
              <tbody>
                {data.zeroSellers.map((z) => (
                  <tr key={z.agentId}>
                    <td style={td}><AgentLink id={z.agentId} name={z.agentName} /></td>
                    <td style={td}>{z.vintage.label}</td>
                    <td style={td}>{z.currentStreakWeeks}</td>
                    <td style={td}>{z.lastSaleDate ?? 'None on record'}</td>
                    <td style={td}>{z.daysSinceLastSale ?? '—'}</td>
                    <td style={td}>{formatUsd(z.lastSaleRevenueUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="pip-current-cycle"
        title="PIP — current cycle"
        subtitle="Anyone on your team currently on a PIP, and how they're tracking against target."
        defaultOpen={data.pipLive.length > 0}
        badge={data.pipLive.length > 0 ? <StatusChip tone="warning">{data.pipLive.length}</StatusChip> : undefined}
      >
        {data.pipLive.length === 0 ? <p style={empty}>Nobody on your team is on a PIP right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Target</th><th style={th}>Achieved</th><th style={th}>Progress</th><th style={th}>Remaining</th><th style={th}>Days left</th><th style={th}>Run rate needed / day</th><th style={th}>Last sale</th><th style={th}></th></tr></thead>
              <tbody>
                {data.pipLive.map((p) => (
                  <tr key={p.agentId}>
                    <td style={td}><AgentLink id={p.agentId} name={p.agentName} /></td>
                    <td style={td}>{formatUsd(p.targetUsd)}</td>
                    <td style={td}>{formatUsd(p.achievedUsd)}</td>
                    <td style={td}><PipProgressBar achievedUsd={p.achievedUsd} targetUsd={p.targetUsd} met={p.targetMet} /></td>
                    <td style={td}>{p.targetMet ? <StatusChip tone="success">Target met</StatusChip> : formatUsd(p.remainingUsd)}</td>
                    <td style={td}>{p.daysLeft}</td>
                    <td style={td}>{p.targetMet ? '—' : p.runRateRequiredUsdPerDay !== null ? formatUsd(p.runRateRequiredUsdPerDay) : '—'}</td>
                    <td style={td}>{p.lastSaleDate ?? 'None on record'}</td>
                    <td style={td}><Link href={`/pip/${p.candidateId}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Feedback &amp; training →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="review-requests"
        title="Review Requests still open"
        subtitle="Not scoped to the period picker — always the current open list."
        defaultOpen={data.openReviewRequests.length > 0}
        badge={data.openReviewRequests.length > 0 ? <StatusChip tone="warning">{data.openReviewRequests.length}</StatusChip> : undefined}
      >
        {data.openReviewRequests.length === 0 ? <p style={empty}>Nothing open right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Status</th><th style={th}>Days open</th></tr></thead>
              <tbody>
                {data.openReviewRequests.map((r) => (
                  <tr key={r.requestId}>
                    <td style={td}><AgentLink id={r.agentId} name={r.agentName} /></td>
                    <td style={td}><StatusChip tone="neutral">{STATUS_LABEL[r.status]}</StatusChip></td>
                    <td style={td}>{r.daysOpen >= 5 ? <StatusChip tone="alert">{r.daysOpen} days</StatusChip> : `${r.daysOpen} days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="recent-audits"
        title="Recent audits"
        subtitle="The team's last 15 submitted audits, regardless of period."
        defaultOpen={false}
      >
        {data.recentAudits.length === 0 ? <p style={empty}>No submitted audits yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Score</th><th style={th}>When</th><th style={th}></th></tr></thead>
              <tbody>
                {data.recentAudits.map((a) => (
                  <tr key={a.auditId}>
                    <td style={td}><AgentLink id={a.agentId} name={a.agentName} /></td>
                    <td style={td}>
                      {a.criticalFail ? <StatusChip tone="alert">{a.scorePercent}% — critical fatal</StatusChip> : `${a.scorePercent}%`}
                    </td>
                    <td style={td}>{formatDhakaDateTime(a.submittedAt)}</td>
                    <td style={td}><AuditLink id={a.auditId} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
