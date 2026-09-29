import Link from 'next/link'
import { isMissingCapaSchema, listPendingReaudits, type PendingReaudit } from '@/lib/capa/capa.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

/**
 * Failed audits QA flagged as needing a follow-up re-audit and that haven't been re-audited yet.
 * The next audit of that agent can be linked to it from the audit page. (Not wired into the
 * sampling / priority queue yet — by design.) Shows nothing at all until schema_028 is applied.
 */
export async function PendingReauditsSection() {
  let items: PendingReaudit[]
  try {
    items = await listPendingReaudits()
  } catch (err) {
    if (isMissingCapaSchema(err)) return null
    console.error(err)
    return (
      <section style={{ marginTop: '28px' }} aria-label="Re-audits waiting">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Re-audits waiting</h2>
        <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>Could not be loaded right now. This does not mean there are none — try again shortly.</div>
      </section>
    )
  }

  return (
    <section style={{ marginTop: '28px', background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-md)', padding: '18px 20px' }} aria-label="Re-audits waiting">
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Re-audits waiting</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Failed audits flagged for a follow-up. When you next audit the agent, link that audit to the failed one.</p>
      {items.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No audits are waiting for a re-audit.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
            <thead><tr><th style={th}>Agent</th><th style={th}>Failed audit</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.auditId}>
                  <td style={td}><b>{r.agentName}</b></td>
                  <td style={td}>
                    <Link href={`/audits/${r.auditId}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>
                      {r.scorePercent === null ? 'Open audit' : `${r.scorePercent}%`}{r.criticalFail ? ' · critical fatal' : ''}
                    </Link>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>By {r.auditorName ?? 'QA'} · {formatDhakaDateTime(r.submittedAt)}</div>
                  </td>
                  <td style={td}>{r.followUpStarted ? 'Follow-up in progress' : 'No follow-up yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
