import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { PolicyForm } from '@/components/admin/pip/PolicyForm'
import { CreateCycleForm } from '@/components/admin/pip/CreateCycleForm'
import { DeleteCycleButton } from '@/components/admin/pip/DeleteCycleButton'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { card, fmtDate, fmtMonth, td, th } from '@/components/pip/pip-display'
import { loadCurrentPolicy, loadCycles, type PipCycle, type PipPolicy } from '@/lib/pip/pip.service'

export default async function PipAdminPage() {
  let policy: PipPolicy | null = null
  let cycles: PipCycle[] = []
  let failure: unknown = null
  try {
    ;[policy, cycles] = await Promise.all([loadCurrentPolicy(), loadCycles()])
  } catch (err) {
    failure = err
    if (!isMissingPipSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Performance Improvement Plans</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        A monthly cycle suggests the lowest-revenue agents per site; a person then approves or excludes each one. This screen sends no
        emails or notifications of any kind.
      </p>

      {failure ? (
        isMissingPipSchema(failure) ? <SchemaMissing /> : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>PIP data could not be loaded right now. This does not mean there is none — try again shortly.</div>
        )
      ) : (
        <>
          <section style={{ ...card, marginBottom: '20px' }} aria-label="Policy">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Policy</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Current policy since {policy ? fmtDate(policy.effectiveFrom) : '—'}. Saving creates a new version; cycles already made keep theirs.
            </p>
            {policy ? <PolicyForm policy={policy} /> : <div style={{ fontSize: '13px' }}>No policy found.</div>}
          </section>

          <section style={{ ...card, marginBottom: '20px' }} aria-label="New cycle">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>New monthly cycle</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Starts on the 2nd Saturday of the month and runs the policy&apos;s number of whole sales weeks (Saturday–Friday).
            </p>
            <CreateCycleForm />
          </section>

          <section style={card} aria-label="Cycles">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>Cycles</h2>
            {cycles.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No cycles yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
                  <thead><tr><th style={th}>Month</th><th style={th}>Runs</th><th style={th}>Candidates</th><th style={th} /><th style={th} /></tr></thead>
                  <tbody>
                    {cycles.map((c) => (
                      <tr key={c.id}>
                        <td style={td}><b>{fmtMonth(c.month)}</b></td>
                        <td style={td}>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                        <td style={td}>{c.candidateCount}</td>
                        <td style={td}><Link href={`/admin/pip/${c.id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open</Link></td>
                        <td style={td}>
                          {!c.publishedAt && <DeleteCycleButton cycleId={c.id} candidateCount={c.candidateCount} monthLabel={fmtMonth(c.month)} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
