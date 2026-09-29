import Link from 'next/link'
import { getAuthUser } from '@/lib/auth/auth.service'
import { isMissingReviewRequestSchema, loadAssignedToMe } from '@/lib/review-requests/review-requests.service'

/**
 * A QA Auditor's own entry point into a Review Request assigned to them for re-audit (§4, Section
 * D, Part 1) — without this, they have no way to discover one exists at all (it isn't in the
 * normal call-browsing flow). QA Manager/Super Admin use /admin/review-requests instead.
 */
export async function AssignedReviewRequestsSection() {
  const user = await getAuthUser()
  if (!user || user.role !== 'qa_auditor') return null

  let items: Awaited<ReturnType<typeof loadAssignedToMe>> = []
  try {
    items = await loadAssignedToMe(user.profile.id)
  } catch (err) {
    if (isMissingReviewRequestSchema(err)) return null
    console.error(err)
    return (
      <section style={{ marginTop: '28px' }} aria-label="Review Requests assigned to you">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Review Requests assigned to you</h2>
        <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>Could not be loaded right now. This does not mean there are none — try again shortly.</div>
      </section>
    )
  }
  if (items.length === 0) return null

  const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
  return (
    <section style={{ marginTop: '28px' }} aria-label="Review Requests assigned to you">
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Review Requests assigned to you ({items.length})</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Waiting for you to start the re-audit.</p>
      <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td style={td}><b>{r.agentName ?? 'Unknown agent'}</b></td>
                <td style={td}>{r.reason.length > 80 ? `${r.reason.slice(0, 80)}…` : r.reason}</td>
                <td style={td}><Link href={`/audits/${r.auditId}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
