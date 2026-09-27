import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { card, fmtDate, fmtMonth, td, th } from '@/components/pip/pip-display'
import { loadCyclesForManagerReview, type PipManagerCycleSummary } from '@/lib/pip/pip.service'

// §6.4, PIP Stage 3: a Manager's landing list of PIP cycles still open for review — i.e. not yet
// published. A Manager never sees a published cycle here; that one shows on /pip instead, once
// their own people are on it. Cycles this Manager has no one in still list (an empty candidate
// list on /pip/review/[cycleId] says so plainly) — filtering here would just hide the "nothing of
// yours is on this one yet, but you could still request an Include" case.
export default async function PipReviewListPage() {
  let cycles: PipManagerCycleSummary[] = []
  let failure: unknown = null
  try {
    cycles = await loadCyclesForManagerReview()
  } catch (err) {
    failure = err
    if (!isMissingPipSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>PIP cycles — review</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Before QA publishes a cycle's final list, you can request that one of your own people be excluded, or
        request that someone not currently listed be included — with a reason either way. QA Manager or Super
        Admin decides each request.
      </p>

      {failure ? (
        isMissingPipSchema(failure) ? <SchemaMissing /> : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>PIP cycles could not be loaded right now. This does not mean there are none — try again shortly.</div>
        )
      ) : (
        <section style={card} aria-label="Open cycles">
          {cycles.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No PIP cycle is currently open for review.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
                <thead><tr><th style={th}>Month</th><th style={th}>Runs</th><th style={th}>Your people on it</th><th style={th} /></tr></thead>
                <tbody>
                  {cycles.map((c) => (
                    <tr key={c.cycleId}>
                      <td style={td}><b>{fmtMonth(c.month)}</b></td>
                      <td style={td}>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                      <td style={td}>{c.myCount}</td>
                      <td style={td}><Link href={`/pip/review/${c.cycleId}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Review →</Link></td>
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
