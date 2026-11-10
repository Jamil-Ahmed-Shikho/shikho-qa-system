import type { ContactStageRow } from '@/lib/contact-stage/contact-stage.service'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '8px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

/** Distinct stages present, ordered by total calls_done descending (most-audited stage first) —
 *  unlike duration, a contact stage has no fixed natural order, so the data decides. */
function stageList(rows: ContactStageRow[]): string[] {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.stage, (totals.get(r.stage) ?? 0) + r.callsDone)
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([stage]) => stage)
}

/** Company-wide shape, at a glance — plain SVG, no charting dependency, same convention as the
 *  Call Duration report. One horizontal bar per stage, showing what % of ALL audited calls in view
 *  were on a lead at that stage. */
export function ContactStageChart({ rows }: { rows: ContactStageRow[] }) {
  const stages = stageList(rows)
  const totalsByStage = new Map(stages.map((s) => [s, 0]))
  let grandTotal = 0
  for (const r of rows) {
    totalsByStage.set(r.stage, (totalsByStage.get(r.stage) ?? 0) + r.callsDone)
    grandTotal += r.callsDone
  }
  if (grandTotal === 0) return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No calls audited in this period.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {stages.map((stage) => {
        const n = totalsByStage.get(stage) ?? 0
        const pct = grandTotal > 0 ? (n / grandTotal) * 100 : 0
        const notRecorded = stage === 'Not recorded'
        return (
          <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '170px', fontSize: '12.5px', color: notRecorded ? 'var(--text-muted)' : 'var(--text-secondary)', flexShrink: 0, fontStyle: notRecorded ? 'italic' : 'normal' }}>{stage}</div>
            <div style={{ flex: 1, height: '16px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(pct, n > 0 ? 1.5 : 0)}%`, background: notRecorded ? 'var(--text-muted)' : 'var(--brand)', borderRadius: 'var(--radius-pill)' }} />
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

/** Auditor × contact-stage matrix — one row per auditor, one column per stage (count + their OWN
 *  row's %, so each row reads "of MY audited calls, what % were on a lead at this stage"), a Total
 *  column, and a company-wide Total row at the bottom. Same shape as CallDurationTable. */
export function ContactStageTable({ rows }: { rows: ContactStageRow[] }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No audited calls in this period.</p>
  }
  const stages = stageList(rows)
  const byAuditor = new Map<string, ContactStageRow[]>()
  for (const r of rows) {
    const list = byAuditor.get(r.auditorId) ?? []
    list.push(r)
    byAuditor.set(r.auditorId, list)
  }
  const auditors = [...byAuditor.entries()].map(([auditorId, stageRows]) => {
    const byStage = new Map(stageRows.map((r) => [r.stage, r.callsDone]))
    const total = stageRows.reduce((sum, r) => sum + r.callsDone, 0)
    return { auditorId, auditorName: stageRows[0].auditorName, byStage, total }
  })
  auditors.sort((a, b) => a.auditorName.localeCompare(b.auditorName))

  const stageTotals = new Map(stages.map((s) => [s, auditors.reduce((sum, a) => sum + (a.byStage.get(s) ?? 0), 0)]))
  const grandTotal = auditors.reduce((sum, a) => sum + a.total, 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Auditor</th>
            {stages.map((s) => <th key={s} style={{ ...th, textAlign: 'center' }}>{s}</th>)}
            <th style={{ ...th, textAlign: 'center' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {auditors.map((a) => (
            <tr key={a.auditorId}>
              <td style={td}><b>{a.auditorName}</b></td>
              {stages.map((s) => {
                const n = a.byStage.get(s) ?? 0
                const pct = a.total > 0 ? (n / a.total) * 100 : 0
                return (
                  <td key={s} style={{ ...td, textAlign: 'center' }}>
                    {n}
                    {a.total > 0 && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</div>}
                  </td>
                )
              })}
              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{a.total}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--highlight-light)' }}>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none' }}>Total</td>
            {stages.map((s) => {
              const n = stageTotals.get(s) ?? 0
              const pct = grandTotal > 0 ? (n / grandTotal) * 100 : 0
              return (
                <td key={s} style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>
                  {n}
                  {grandTotal > 0 && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>{pct.toFixed(1)}%</div>}
                </td>
              )
            })}
            <td style={{ ...td, textAlign: 'center', fontWeight: 700, borderBottom: 'none' }}>{grandTotal}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
        Each auditor&apos;s % is of THEIR OWN audited calls (their row sums to ~100%) — the Total row&apos;s % is of all audited calls
        in view. &quot;Not recorded&quot; means the stage wasn&apos;t captured for that call (before this report existed, or a CRM lookup
        failure). Sample Checks are excluded — this counts real audits only.
      </p>
    </div>
  )
}
