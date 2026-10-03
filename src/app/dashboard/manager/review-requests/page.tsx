import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { isMissingReviewRequestSchema, loadManagerFileableAudits, type ManagerFileableAudit } from '@/lib/review-requests/review-requests.service'
import { FileReviewRequestForm } from '@/components/review-requests/ReviewRequestForms'
import { formatDhakaDateTime } from '@/lib/dates/format'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export default async function ManagerReviewRequestsPage() {
  let audits: ManagerFileableAudit[] = []
  let failure: unknown = null
  try {
    audits = await loadManagerFileableAudits()
  } catch (err) {
    failure = err
    if (!isMissingReviewRequestSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <BackLink href="/dashboard/manager" label="Manager Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Request a Review</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '640px' }}>
        Audits submitted in the last 7 days for agents in your chain. If you think one is wrong, you can request a
        review on the agent&apos;s behalf — no need for them to file it themselves. It goes straight to QA Manager.
      </p>

      {failure ? (
        isMissingReviewRequestSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            This feature isn&apos;t available yet — check back shortly.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. This does not mean there is nothing to show — try again shortly.</div>
        )
      ) : audits.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Nothing in your chain is eligible right now — either no audits in the last 7 days, or each has already been requested for review.
        </div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr><th style={th}>Agent</th><th style={th}>Score</th><th style={th}>Submitted</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    {a.agentName ? (
                      <Link href={`/dashboard/manager/agent/${a.agentId}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>{a.agentName}</Link>
                    ) : (
                      <b>Unknown agent</b>
                    )}
                  </td>
                  <td style={td}>
                    {a.scorePercent === null ? '—' : `${a.scorePercent}%`}
                    {a.criticalFail ? ' · critical fatal' : a.passed === false ? ' · did not pass' : ''}
                  </td>
                  <td style={td}>{formatDhakaDateTime(a.submittedAt)}</td>
                  <td style={{ ...td, minWidth: '320px' }}>
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--brand)' }}>Request a review…</summary>
                      <div style={{ marginTop: '10px' }}>
                        <FileReviewRequestForm auditId={a.id} onBehalfOf={a.agentName} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
