import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { ManagerNotListedRow } from '@/components/pip/ManagerNotListedRow'
import { ManagerReviewRow } from '@/components/pip/ManagerReviewRow'
import { card, fmtDate, fmtMonth, th } from '@/components/pip/pip-display'
import { loadManagerCycleInfo, loadManagerNotListed, loadManagerReview } from '@/lib/pip/pip.service'

// §6.4, PIP Stage 3: a Manager's own pre-publish view of one cycle — the QA-generated list (with a
// Request Exclude / Request Include-again per row) plus their own chain's agents not on the list
// yet (a separate Request Include). Nothing here is a direct edit — every action is a request QA
// Manager/Super Admin accepts or rejects (pip_decide_request, schema_043).
export default async function PipReviewCyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params
  let info: Awaited<ReturnType<typeof loadManagerCycleInfo>> = null
  let rows: Awaited<ReturnType<typeof loadManagerReview>> = []
  let notListed: Awaited<ReturnType<typeof loadManagerNotListed>> = []
  try {
    ;[info, rows, notListed] = await Promise.all([
      loadManagerCycleInfo(cycleId),
      loadManagerReview(cycleId),
      loadManagerNotListed(cycleId),
    ])
  } catch (err) {
    if (isMissingPipSchema(err)) {
      return <div><BackLink href="/pip/review" label="PIP cycles" /><SchemaMissing /></div>
    }
    console.error(err)
    return (
      <div>
        <BackLink href="/pip/review" label="PIP cycles" />
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>This cycle could not be loaded right now. This does not mean it is empty — try again shortly.</div>
      </div>
    )
  }
  if (!info) notFound()

  return (
    <div style={{ maxWidth: '960px' }}>
      <BackLink href="/pip/review" label="PIP cycles" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>PIP cycle — {fmtMonth(info.month)}</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Runs {fmtDate(info.startDate)} – {fmtDate(info.endDate)}
      </p>

      {info.publishedAt ? (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', fontSize: '13px', marginBottom: '16px' }}>
          This cycle has already been published — requests are closed. Your own published people show on <a href="/pip" style={{ color: 'var(--brand)' }}>the PIP list</a>.
        </div>
      ) : (
        <>
          <section style={{ ...card, marginBottom: '16px' }} aria-label="Your people on the suggestion list">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Your people on the list</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px', maxWidth: '680px' }}>
              Request Exclude on a suggested row, or Request Include again on one already excluded — QA Manager
              or Super Admin decides.
            </p>
            {rows.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody in your chain is currently suggested or excluded on this cycle.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
                  <thead><tr><th style={th}>Agent</th><th style={th}>Revenue</th><th style={th}>Vintage</th><th style={th}>Status</th><th style={th}>Request</th></tr></thead>
                  <tbody>{rows.map((r) => <ManagerReviewRow key={r.candidateId} cycleId={cycleId} row={r} />)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section style={card} aria-label="Request someone be included">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Not currently on the list</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px', maxWidth: '680px' }}>
              Someone in your chain you believe should be considered, with a reason.
            </p>
            {notListed.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Everyone in your chain is already on the list.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
                  <thead><tr><th style={th}>Agent</th><th style={th}>Request</th></tr></thead>
                  <tbody>{notListed.map((a) => <ManagerNotListedRow key={a.agentId} cycleId={cycleId} agent={a} />)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
