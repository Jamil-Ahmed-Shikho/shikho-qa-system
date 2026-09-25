import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { CandidateActions } from '@/components/admin/pip/CandidateActions'
import { GenerateForm } from '@/components/admin/pip/GenerateForm'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { StatusBadge, card, fmtDate, fmtMoney, fmtMonth, td, th } from '@/components/pip/pip-display'
import { loadCycleWithCandidates } from '@/lib/pip/pip.service'
import { describeVintageDays } from '@/lib/pip/validation'

export default async function PipCyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params
  let data: Awaited<ReturnType<typeof loadCycleWithCandidates>> = null
  try {
    data = await loadCycleWithCandidates(cycleId)
  } catch (err) {
    if (isMissingPipSchema(err)) {
      return <div><BackLink href="/admin/pip" label="All PIP cycles" /><SchemaMissing /></div>
    }
    console.error(err)
    return (
      <div>
        <BackLink href="/admin/pip" label="All PIP cycles" />
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>This cycle could not be loaded right now. This does not mean it is empty — try again shortly.</div>
      </div>
    )
  }
  if (!data) notFound()
  const { cycle, policy, candidates } = data

  const bySite = new Map<string, typeof candidates>()
  for (const c of candidates) bySite.set(c.siteName ?? '(no site)', [...(bySite.get(c.siteName ?? '(no site)') ?? []), c])
  const ready = !!policy && policy.revenueWindowWeeks !== null && policy.revenueUnit !== null

  return (
    <div style={{ maxWidth: '1100px' }}>
      <BackLink href="/admin/pip" label="All PIP cycles" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>PIP cycle — {fmtMonth(cycle.month)}</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Runs {fmtDate(cycle.startDate)} – {fmtDate(cycle.endDate)}
        {policy && <> · benchmark {policy.revenueBenchmark} · minimum vintage {policy.vintageMinDays} days · bottom {policy.bottomNPerSite} per site
          {policy.revenueWindowWeeks !== null && <> · revenue over the {policy.revenueWindowWeeks} weeks before the cycle, in {policy.revenueUnit}</>}</>}
      </p>

      {candidates.length === 0 && (
        <section style={{ ...card, marginBottom: '20px' }} aria-label="Suggest candidates">
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>Suggest candidates</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', maxWidth: '680px' }}>
            Picks, per site, the lowest-revenue certified agents below the benchmark who have been on the job long enough — and who are not
            already inside a PIP that is still running. Nothing is decided here: each suggestion waits for a person.
          </p>
          <GenerateForm cycleId={cycle.id} ready={ready} />
        </section>
      )}

      {[...bySite.entries()].map(([site, rows]) => (
        <section key={site} style={{ ...card, marginBottom: '16px' }} aria-label={`Candidates — ${site}`}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>{site} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '13px' }}>({rows.length})</span></h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead>
                <tr><th style={th}>Agent</th><th style={th}>Revenue</th><th style={th}>Vintage</th><th style={th}>Status</th><th style={th}>Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>
                      <b>{c.agentName}</b>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.teamName ?? '—'}</div>
                    </td>
                    <td style={td}>
                      {fmtMoney(c.revenue, c.revenueUnit)}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{fmtDate(c.windowStart)} – {fmtDate(c.windowEnd)}</div>
                    </td>
                    <td style={td}>{describeVintageDays(c.vintageDays)}</td>
                    <td style={td}>
                      <StatusBadge status={c.status} />
                      {c.exclusionReason && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Reason: {c.exclusionReason}</div>}
                      {c.decisionNote && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Note: {c.decisionNote}</div>}
                      {c.incentiveDowngraded && <div style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '4px' }}>Incentive downgraded</div>}
                    </td>
                    <td style={td}>
                      <CandidateActions candidateId={c.id} cycleId={cycle.id} status={c.status} agentName={c.agentName} />
                      {(c.status === 'approved' || c.status === 'completed' || c.status === 'failed') && (
                        <div style={{ marginTop: '6px' }}>
                          <Link href={`/pip/${c.id}`} style={{ fontSize: '12px', color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Feedback &amp; training →</Link>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
