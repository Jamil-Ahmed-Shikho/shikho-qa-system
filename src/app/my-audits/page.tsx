import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { DisputeStatusPill, OutcomePill } from '@/components/disputes/DisputePanel'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { loadMyAudits, type MyAuditItem } from '@/lib/disputes/disputes.service'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }

export default async function MyAuditsPage() {
  let audits: MyAuditItem[] = []
  let failed = false
  try {
    audits = await loadMyAudits()
  } catch (err) {
    failed = true
    console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>My audits</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '640px' }}>
        Your submitted audits. Open one to see the full scorecard and feedback — and, if you think it is wrong, to dispute it.
      </p>

      {failed ? (
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Your audits could not be loaded right now. This does not mean you have none — try again shortly.</div>
      ) : audits.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>No submitted audits yet.</div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead><tr><th style={th}>Audited</th><th style={th}>Score</th><th style={th}>Result</th><th style={th}>Dispute</th><th style={th} /></tr></thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{formatDhakaDateTime(a.submittedAt)}<div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Call {formatDhakaDateTime(a.callStartedAt)}</div></td>
                  <td style={{ ...td, fontWeight: 600 }}>{a.scorePercent === null ? '—' : `${a.scorePercent}%`}</td>
                  <td style={{ ...td, color: a.passed ? 'var(--status-green)' : 'var(--alert)', fontWeight: 600 }}>
                    {a.criticalFail ? 'Critical fatal error' : a.passed ? 'Passed' : 'Did not pass'}
                  </td>
                  <td style={td}>
                    {a.dispute ? (
                      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <DisputeStatusPill status={a.dispute.status} />
                        {a.dispute.outcome && <OutcomePill outcome={a.dispute.outcome} />}
                        {a.dispute.filedOnBehalf && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>filed by your Team Lead</span>}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={td}><Link href={`/my-audits/${a.id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
