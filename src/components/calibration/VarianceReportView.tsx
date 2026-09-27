import type { VarianceReport } from '@/lib/calibration/variance'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 500 }
const td: React.CSSProperties = { padding: '8px', fontSize: '14px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)', verticalAlign: 'top' }
const ROLE_LABEL: Record<string, string> = { qa_auditor: 'QA Auditor', qa_manager: 'QA Manager', super_admin: 'Super Admin', team_lead: 'Team Lead' }
const POS: Record<string, string> = { highest: 'Highest', lowest: 'Lowest', middle: '', only: '' }

function sign(n: number) { return n > 0 ? `+${n}` : String(n) }

/** Server-safe: the variance report — who scored high/low relative to the group, and where they disagreed. */
export function VarianceReportView({ report }: { report: VarianceReport }) {
  if (report.count < 2) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>A variance report needs at least two submitted scores.</p>
  }
  return (
    <div>
      <p style={{ fontSize: '14px', margin: '0 0 12px' }}>
        {report.count} scores · group average <b>{report.mean}%</b> · range {report.min}%–{report.max}% ({report.range} points) · standard deviation {report.stdDev}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
          <thead><tr><th style={th}>Participant</th><th style={th}>Score</th><th style={th}>Vs group average</th><th style={th} /></tr></thead>
          <tbody>
            {report.participants.map((p) => (
              <tr key={p.userId}>
                <td style={td}>{p.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{ROLE_LABEL[p.role] ?? p.role}</span>
                  {p.notes && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{p.notes}</div>}</td>
                <td style={td}><b>{p.scorePercent}%</b>{p.criticalFail && <span style={{ fontSize: '11px', color: 'var(--alert)', marginLeft: '6px' }}>critical fatal</span>}</td>
                <td style={td}>{sign(p.deviation)} pts</td>
                <td style={td}>{POS[p.position]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: '14px', margin: '16px 0 6px' }}>Where the group disagreed</h3>
      {report.splitParameters.length === 0 && report.fatals.every((f) => f.unanimous) ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Everyone marked every parameter and fatal error the same way.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '14px', display: 'grid', gap: '6px' }}>
          {report.splitParameters.map((p) => (
            <li key={p.parameterId}><b>{p.name}</b> ({p.points} pts, {p.category}) — Pass: {p.passed.join(', ')}; Fail: {p.failed.join(', ')}</li>
          ))}
          {report.fatals.filter((f) => !f.unanimous).map((f) => (
            <li key={f.fatalId}><b>{f.description}</b> ({f.severity}) — ticked by {f.ticked.join(', ')}; not ticked by {f.notTicked.join(', ')}</li>
          ))}
        </ul>
      )}
      {report.fatals.some((f) => f.unanimous) && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
          Fatal errors everyone ticked: {report.fatals.filter((f) => f.unanimous).map((f) => f.description).join('; ')}
        </p>
      )}
    </div>
  )
}
