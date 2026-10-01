import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { ReviewRequestStatusPill } from '@/components/review-requests/ReviewRequestPanel'
import { FINAL_OUTCOME_LABEL } from '@/lib/review-requests/validation'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { loadMyAudits, type MyAuditItem } from '@/lib/review-requests/review-requests.service'

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
      <BackLink href="/dashboard" label="Dashboard" size="lg" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>My audits</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '640px' }}>
        Your submitted audits. Open one to see the full scorecard and feedback — and, if you think it is wrong, to request a review.
      </p>

      {failed ? (
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Your audits could not be loaded right now. This does not mean you have none — try again shortly.</div>
      ) : audits.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>No submitted audits yet.</div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead><tr><th style={th}>Audited</th><th style={th}>Auditor</th><th style={th}>Score</th><th style={th}>Result</th><th style={th}>Review Request</th><th style={th} /></tr></thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{formatDhakaDateTime(a.submittedAt)}<div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Call {formatDhakaDateTime(a.callStartedAt)}</div></td>
                  <td style={td}>{a.auditorName ?? '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{a.scorePercent === null ? '—' : `${a.scorePercent}%`}</td>
                  <td style={{ ...td, color: a.passed ? 'var(--status-green)' : 'var(--alert)', fontWeight: 600 }}>
                    {a.criticalFail ? 'Critical fatal error' : a.passed ? 'Passed' : 'Did not pass'}
                    {a.supersededBy && <div style={{ fontSize: '11px', color: 'var(--status-green)', fontWeight: 400 }}>Revised</div>}
                  </td>
                  <td style={td}>
                    {a.reviewRequest ? (
                      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <ReviewRequestStatusPill status={a.reviewRequest.status} />
                        {a.reviewRequest.finalOutcome && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{FINAL_OUTCOME_LABEL[a.reviewRequest.finalOutcome]}</span>}
                        {a.reviewRequest.filerRole !== 'agent' && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>filed on your behalf</span>}
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
