import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { StatusBadge, card, fmtDate, td, th } from '@/components/pip/pip-display'
import { loadVisiblePips, type PipCandidate } from '@/lib/pip/pip.service'

export default async function PipListPage() {
  let pips: PipCandidate[] = []
  let failure: unknown = null
  try {
    pips = await loadVisiblePips()
  } catch (err) {
    failure = err
    if (!isMissingPipSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Performance Improvement Plans</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Agents on an approved PIP within your scope. A Team Lead records feedback here; QA staff track the training sessions.
      </p>

      {failure ? (
        isMissingPipSchema(failure) ? <SchemaMissing /> : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>PIPs could not be loaded right now. This does not mean there are none — try again shortly.</div>
        )
      ) : (
        <section style={card} aria-label="PIPs">
          {pips.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No agents on a PIP.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
                <thead><tr><th style={th}>Agent</th><th style={th}>Site</th><th style={th}>Runs</th><th style={th}>Status</th><th style={th} /></tr></thead>
                <tbody>
                  {pips.map((p) => (
                    <tr key={p.id}>
                      <td style={td}><b>{p.agentName}</b><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.teamName ?? '—'}</div></td>
                      <td style={td}>{p.siteName ?? '—'}</td>
                      <td style={td}>{fmtDate(p.cycleStart)} – {fmtDate(p.cycleEnd)}</td>
                      <td style={td}><StatusBadge status={p.status} /></td>
                      <td style={td}><Link href={`/pip/${p.id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
