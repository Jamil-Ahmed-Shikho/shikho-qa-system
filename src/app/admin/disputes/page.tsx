import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { DisputeAdminControls } from '@/components/disputes/DisputeForms'
import { DisputeDetails, DisputeStatusPill, OutcomePill } from '@/components/disputes/DisputePanel'
import { filedByLine } from '@/lib/disputes/validation'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { isMissingDisputesSchema, listDisputes, type DisputeListItem } from '@/lib/disputes/disputes.service'

type View = 'awaiting' | 'resolved' | 'all'
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'awaiting', label: 'Awaiting a decision' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
]

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export default async function DisputesAdminPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams
  const view: View = show === 'resolved' || show === 'all' ? show : 'awaiting'
  const user = await getAuthUser()

  let disputes: DisputeListItem[] = []
  let failure: unknown = null
  try {
    disputes = await listDisputes(view)
  } catch (err) {
    failure = err
    if (!isMissingDisputesSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Disputes</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Agents — or their Team Leads on their behalf — dispute an audit here. Review each one and record a decision. Resolving
        records the outcome and your note; it does not change the audit&apos;s score.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }} role="tablist" aria-label="Dispute view">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.key === 'awaiting' ? '/admin/disputes' : `/admin/disputes?show=${v.key}`} role="tab" aria-selected={view === v.key}
            style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: view === v.key ? 600 : 400, background: view === v.key ? 'var(--brand)' : 'var(--surface-1)', color: view === v.key ? 'white' : 'var(--text-secondary)' }}>
            {v.label}
          </Link>
        ))}
      </div>

      {failure ? (
        isMissingDisputesSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>The disputes database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_028_capa_disputes.sql</code> in the Supabase SQL Editor (after 027), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Disputes could not be loaded right now. This does not mean there are none — try again shortly.</div>
        )
      ) : disputes.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>
          {view === 'awaiting' ? 'Nothing is waiting for a decision.' : 'No disputes.'}
        </div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
            <thead><tr><th style={th}>Agent</th><th style={th}>Audit</th><th style={th}>Filed</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td style={td}><b>{d.agentName ?? 'Unknown agent'}</b></td>
                  <td style={td}>
                    <Link href={`/audits/${d.auditId}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>
                      {d.auditScore === null ? 'Open audit' : `${d.auditScore}%`}{d.auditCriticalFail ? ' · critical fatal' : d.auditPassed === false ? ' · did not pass' : ''}
                    </Link>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>By {d.auditorName ?? 'QA'} · {formatDhakaDateTime(d.auditSubmittedAt)}</div>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: d.filedOnBehalf ? 600 : 400, color: d.filedOnBehalf ? 'var(--brand)' : 'inherit' }}>{filedByLine(d)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDhakaDateTime(d.createdAt)}</div>
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}><DisputeStatusPill status={d.status} />{d.outcome && <OutcomePill outcome={d.outcome} />}</span>
                    <details style={{ marginTop: '8px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--brand)' }}>{d.status === 'resolved' ? 'Show decision' : 'Review'}</summary>
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '300px' }}>
                        <DisputeDetails d={d} />
                        {d.status !== 'resolved' && <DisputeAdminControls disputeId={d.id} auditId={d.auditId} status={d.status} youConducted={!!user && d.auditorId === user.profile.id} />}
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
