import type { CallDurationRow } from '@/lib/call-duration/call-duration.service'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '8px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

/** The 7 slabs, in order — derived from the rows themselves (slab_order, from the database) rather
 *  than hardcoded here a second time, so the two can never drift apart. */
function slabList(rows: CallDurationRow[]): string[] {
  const bySlab = new Map<number, string>()
  for (const r of rows) bySlab.set(r.slabOrder, r.slab)
  return [...bySlab.entries()].sort((a, b) => a[0] - b[0]).map(([, slab]) => slab)
}

/** Company-wide shape, at a glance — plain SVG, no charting dependency, same convention as this
 *  app's other sparklines/bar charts (Agent Dashboard, Campaign Report). One horizontal bar per
 *  slab, showing what % of ALL audited calls in view fell into it. */
export function CallDurationChart({ rows }: { rows: CallDurationRow[] }) {
  const slabs = slabList(rows)
  const totalsBySlab = new Map(slabs.map((s) => [s, 0]))
  let grandTotal = 0
  for (const r of rows) {
    totalsBySlab.set(r.slab, (totalsBySlab.get(r.slab) ?? 0) + r.callsDone)
    grandTotal += r.callsDone
  }
  if (grandTotal === 0) return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No calls audited in this period.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {slabs.map((slab) => {
        const n = totalsBySlab.get(slab) ?? 0
        const pct = grandTotal > 0 ? (n / grandTotal) * 100 : 0
        return (
          <div key={slab} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '140px', fontSize: '12.5px', color: 'var(--text-secondary)', flexShrink: 0 }}>{slab}</div>
            <div style={{ flex: 1, height: '16px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(pct, n > 0 ? 1.5 : 0)}%`, background: 'var(--brand)', borderRadius: 'var(--radius-pill)' }} />
            </div>
            <div style={{ width: '92px', fontSize: '12.5px', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
              {n} ({pct.toFixed(1)}%)
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Auditor × duration-slab matrix — one row per auditor, one column per slab (count + their OWN
 *  row's %, so each row reads "of MY audited calls, what % were this long"), a Total column, and a
 *  company-wide Total row at the bottom. Same shape as DailyActivityTable (qa-ranking). */
export function CallDurationTable({ rows }: { rows: CallDurationRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No active QA Auditors on record yet.</p>
  }
  const slabs = slabList(rows)
  const byAuditor = new Map<string, CallDurationRow[]>()
  for (const r of rows) {
    const list = byAuditor.get(r.auditorId) ?? []
    list.push(r)
    byAuditor.set(r.auditorId, list)
  }
  const auditors = [...byAuditor.entries()].map(([auditorId, slabRows]) => {
    const bySlab = new Map(slabRows.map((r) => [r.slab, r.callsDone]))
    const total = slabRows.reduce((sum, r) => sum + r.callsDone, 0)
    // Same value on every slab row for this auditor (schema_117) — read off the first one.
    const totalMinutes = slabRows[0]?.totalMinutes ?? 0
    return { auditorId, auditorName: slabRows[0].auditorName, bySlab, total, totalMinutes }
  })
  auditors.sort((a, b) => a.auditorName.localeCompare(b.auditorName))

  const slabTotals = new Map(slabs.map((s) => [s, auditors.reduce((sum, a) => sum + (a.bySlab.get(s) ?? 0), 0)]))
  const grandTotal = auditors.reduce((sum, a) => sum + a.total, 0)
  const grandTotalMinutes = auditors.reduce((sum, a) => sum + a.totalMinutes, 0)
  const fmtMinutes = (m: number) => m.toLocaleString(undefined, { maximumFractionDigits: 0 })
  const fmtAvg = (minutes: number, calls: number) => (calls > 0 ? `${(minutes / calls).toFixed(1)} min` : '—')

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Auditor</th>
            {slabs.map((s) => <th key={s} style={{ ...th, textAlign: 'center' }}>{s}</th>)}
            <th style={{ ...th, textAlign: 'center' }}>Total</th>
            <th style={{ ...th, textAlign: 'center' }}>Total Audited Minutes</th>
            <th style={{ ...th, textAlign: 'center' }}>Avg Call Duration</th>
          </tr>
        </thead>
        <tbody>
          {auditors.map((a) => (
            <tr key={a.auditorId}>
              <td style={td}><b>{a.auditorName}</b></td>
              {slabs.map((s) => {
                const n = a.bySlab.get(s) ?? 0
                const pct = a.total > 0 ? (n / a.total) * 100 : 0
                return (
                  <td key={s} style={{ ...td, textAlign: 'center' }}>
                    {n}
                    {a.total > 0 && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</div>}
                  </td>
                )
              })}
              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{a.total}</td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{fmtMinutes(a.totalMinutes)}</td>
              <td style={{ ...td, textAlign: 'center' }}>{fmtAvg(a.totalMinutes, a.total)}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--highlight-light)' }}>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>Total</td>
            {slabs.map((s) => {
              const n = slabTotals.get(s) ?? 0
              const pct = grandTotal > 0 ? (n / grandTotal) * 100 : 0
              return (
                <td key={s} style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>
                  {n}
                  {grandTotal > 0 && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>{pct.toFixed(1)}%</div>}
                </td>
              )
            })}
            <td style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>{grandTotal}</td>
            <td style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>{fmtMinutes(grandTotalMinutes)}</td>
            <td style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>{fmtAvg(grandTotalMinutes, grandTotal)}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
        Each auditor&apos;s % is of THEIR OWN audited calls (their row sums to ~100%) — the Total row&apos;s % is of all audited calls
        in view. Total Audited Minutes is the sum of every audited call&apos;s length, this period; Avg Call Duration is that
        divided by the number of calls audited. Sample Checks are excluded — this counts real audits only.
      </p>
    </div>
  )
}
