import { formatUsd } from '@/lib/money/usd'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { TeamLeadDashboard } from '@/lib/team-lead/team-lead-dashboard.service'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '110px', textAlign: 'center' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }

const RYG_COLOR: Record<string, string> = { red: 'var(--alert)', yellow: 'var(--highlight)', green: 'var(--status-green)', unrated: 'var(--text-muted)' }
const RYG_LABEL: Record<string, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', unrated: 'Unrated' }
const STATUS_LABEL: Record<string, string> = { with_team_lead: 'With you', with_qa_manager: 'With QA Manager' }

export function TeamLeadDashboardView({ data }: { data: TeamLeadDashboard }) {
  const notGreen = data.agents.filter((a) => a.rygStatus !== 'green')

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.agentCount}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Agents</div></div>
        <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.auditsDone} / {data.auditTarget}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Audits vs target</div></div>
        <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.auditPct !== null ? `${data.auditPct}%` : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Coverage</div></div>
        <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.avgScore !== null ? `${data.avgScore}%` : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg score</div></div>
        <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{data.passRate !== null ? `${data.passRate}%` : '—'}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pass rate</div></div>
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Agent RYG &amp; Vintage</h2>
        <p style={sectionNote}>Green agents are counted but not listed, to keep this focused on who needs attention.</p>
        {notGreen.length === 0 ? (
          <p style={empty}>Everyone on your team is Green.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Vintage</th><th style={th}>Status</th><th style={th}>Avg score (4wk)</th></tr></thead>
              <tbody>
                {notGreen.map((a) => (
                  <tr key={a.agentId}>
                    <td style={td}><b>{a.name}</b></td>
                    <td style={td} title={a.vintage.detail ?? undefined}>{a.vintage.label}</td>
                    <td style={td}>{a.rygStatus ? <span style={{ color: RYG_COLOR[a.rygStatus], fontWeight: 600 }}>{RYG_LABEL[a.rygStatus]}</span> : '—'}</td>
                    <td style={td}>{a.avgAuditScore !== null ? `${a.avgAuditScore}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Fatal incidents</h2>
        <p style={sectionNote}>Every critical-fatal audit on your team in this period.</p>
        {data.fatalIncidents.length === 0 ? <p style={empty}>None in this period.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Auditor</th><th style={th}>Submitted</th></tr></thead>
              <tbody>
                {data.fatalIncidents.map((f) => (
                  <tr key={f.auditId}><td style={td}><b>{f.agentName}</b></td><td style={td}>{f.auditorName ?? '—'}</td><td style={td}>{formatDhakaDateTime(f.submittedAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Zero-Seller</h2>
        <p style={sectionNote}>Anyone on your team currently on an active zero-seller streak.</p>
        {data.zeroSellers.length === 0 ? <p style={empty}>Nobody on your team is a zero-seller right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Streak (weeks)</th><th style={th}>Last sale</th></tr></thead>
              <tbody>
                {data.zeroSellers.map((z) => (
                  <tr key={z.agentId}><td style={td}><b>{z.agentName}</b></td><td style={td}>{z.currentStreakWeeks}</td><td style={td}>{z.lastSaleDate ?? 'None on record'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>PIP — current cycle</h2>
        <p style={sectionNote}>Anyone on your team currently on a PIP, and how they&apos;re tracking against target.</p>
        {data.pipLive.length === 0 ? <p style={empty}>Nobody on your team is on a PIP right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Target</th><th style={th}>Achieved</th><th style={th}>Days left</th><th style={th}>Run rate needed / day</th></tr></thead>
              <tbody>
                {data.pipLive.map((p) => (
                  <tr key={p.agentId}>
                    <td style={td}><b>{p.agentName}</b></td>
                    <td style={td}>{formatUsd(p.targetUsd)}</td>
                    <td style={td}>{formatUsd(p.achievedUsd)}</td>
                    <td style={td}>{p.daysLeft}</td>
                    <td style={td}>{p.targetMet ? <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>Target met</span> : p.runRateRequiredUsdPerDay !== null ? formatUsd(p.runRateRequiredUsdPerDay) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Review Requests still open</h2>
        <p style={sectionNote}>Not scoped to the period picker — always the current open list.</p>
        {data.openReviewRequests.length === 0 ? <p style={empty}>Nothing open right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Status</th><th style={th}>Days open</th></tr></thead>
              <tbody>
                {data.openReviewRequests.map((r) => (
                  <tr key={r.requestId}><td style={td}><b>{r.agentName}</b></td><td style={td}>{STATUS_LABEL[r.status]}</td><td style={td}><span style={{ fontWeight: r.daysOpen >= 5 ? 700 : 400, color: r.daysOpen >= 5 ? 'var(--alert)' : 'inherit' }}>{r.daysOpen}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>Recent audits</h2>
        <p style={sectionNote}>The team&apos;s last 15 submitted audits, regardless of period.</p>
        {data.recentAudits.length === 0 ? <p style={empty}>No submitted audits yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Score</th><th style={th}>When</th></tr></thead>
              <tbody>
                {data.recentAudits.map((a) => (
                  <tr key={a.auditId}>
                    <td style={td}><b>{a.agentName}</b></td>
                    <td style={td}>
                      <span style={{ color: a.criticalFail ? 'var(--alert)' : 'inherit', fontWeight: a.criticalFail ? 700 : 400 }}>
                        {a.scorePercent}%{a.criticalFail ? ' — critical fatal' : ''}
                      </span>
                    </td>
                    <td style={td}>{formatDhakaDateTime(a.submittedAt)}</td>
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
