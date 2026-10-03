import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { ReviewRequestDetails, ReviewRequestStatusPill } from '@/components/review-requests/ReviewRequestPanel'
import { AssignControls, DecideRevisionControls, StartReauditButton } from '@/components/review-requests/ReviewRequestForms'
import { filedByLine } from '@/lib/review-requests/validation'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { isMissingReviewRequestSchema, listReviewRequests, type AdminView, type ReviewRequestListItem } from '@/lib/review-requests/review-requests.service'

const VIEWS: Array<{ key: AdminView; label: string }> = [
  { key: 'with_qa_manager', label: 'With QA Manager' },
  { key: 'with_team_lead', label: 'With Team Lead' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export default async function ReviewRequestsAdminPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams
  const view: AdminView = (VIEWS.some((v) => v.key === show) ? show : 'with_qa_manager') as AdminView
  const [user, supabase] = [await getAuthUser(), await getSupabaseServer()]

  let requests: ReviewRequestListItem[] = []
  let failure: unknown = null
  try {
    requests = await listReviewRequests(view)
  } catch (err) {
    failure = err
    if (!isMissingReviewRequestSchema(err)) console.error(err)
  }

  // Cheap, small list -- for the inline Assign control on any row still needing it.
  const qaStaff = await supabase.from('users').select('id, name, role').in('role', ['super_admin', 'qa_manager', 'qa_auditor']).eq('is_active', true).order('name')
    .then(
      ({ data }) => (data ?? []).map((u) => ({ id: u.id, name: user && u.id === user.profile.id ? `${u.name} (you)` : u.name, role: u.role })),
      () => []
    )

  return (
    <div style={{ maxWidth: '1000px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Review Requests</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Agents — or their Team Lead/Manager on their behalf — request a review of an audit here. A Team Lead can uphold it
        directly (final, no score change); anything escalated or filed straight to QA reaches you here to assign, re-audit
        and decide.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }} role="tablist" aria-label="Review Request view">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.key === 'with_qa_manager' ? '/admin/review-requests' : `/admin/review-requests?show=${v.key}`} role="tab" aria-selected={view === v.key}
            style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: view === v.key ? 600 : 400, background: view === v.key ? 'var(--brand)' : 'var(--surface-1)', color: view === v.key ? 'white' : 'var(--text-secondary)' }}>
            {v.label}
          </Link>
        ))}
      </div>

      {failure ? (
        isMissingReviewRequestSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>The Review Request database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_048_review_requests.sql</code> in the Supabase SQL Editor (after 047), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Review Requests could not be loaded right now. This does not mean there are none — try again shortly.</div>
        )
      ) : requests.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>
          {view === 'with_qa_manager' ? 'Nothing is waiting for a decision.' : 'No Review Requests.'}
        </div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
            <thead><tr><th style={th}>Agent</th><th style={th}>Audit</th><th style={th}>Filed</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    {r.agentName ? (
                      <Link href={`/audits/agent/${r.agentId}/profile`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>{r.agentName}</Link>
                    ) : (
                      <b>Unknown agent</b>
                    )}
                  </td>
                  <td style={td}>
                    <Link href={`/audits/${r.auditId}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>
                      {r.auditScore === null ? 'Open audit' : `${r.auditScore}%`}{r.auditCriticalFail ? ' · critical fatal' : r.auditPassed === false ? ' · did not pass' : ''}
                    </Link>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>By {r.auditorName ?? 'QA'} · {formatDhakaDateTime(r.auditSubmittedAt)}</div>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: r.filerRole !== 'agent' ? 600 : 400, color: r.filerRole !== 'agent' ? 'var(--brand)' : 'inherit' }}>{filedByLine(r)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDhakaDateTime(r.createdAt)}</div>
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}><ReviewRequestStatusPill status={r.status} /></span>
                    <details style={{ marginTop: '8px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--brand)' }}>{r.status === 'resolved' ? 'Show decision' : 'Review'}</summary>
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '320px' }}>
                        <ReviewRequestDetails r={r} />
                        {r.status === 'with_qa_manager' && (
                          <>
                            {!r.assignedToId && <AssignControls id={r.id} auditId={r.auditId} qaStaff={qaStaff} />}
                            {r.assignedToId && !r.reaudit && <StartReauditButton id={r.id} auditId={r.auditId} />}
                            {r.reaudit && r.reaudit.status !== 'draft' && <DecideRevisionControls id={r.id} auditId={r.auditId} />}
                          </>
                        )}
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
