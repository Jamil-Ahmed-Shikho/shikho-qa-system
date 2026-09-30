import { BackLink } from '@/components/common/BackLink'
import {
  isMissingRepeatMistakeSchema,
  loadRepeatMistakeReport,
  STATUS_LABEL,
  type RepeatMistakeRow,
} from '@/lib/repeat-mistakes/repeat-mistakes.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const selectStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--paper)',
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

const STATUS_COLOR: Record<RepeatMistakeRow['status'], string> = {
  still_failing: 'var(--alert)',
  improved: 'var(--status-green)',
  not_yet_rechecked: 'var(--text-muted)',
}

export default async function RepeatMistakeReportPage({ searchParams }: { searchParams: Promise<{ parameter?: string }> }) {
  const sp = await searchParams

  let rows: RepeatMistakeRow[] = []
  let failure: unknown = null
  try {
    rows = await loadRepeatMistakeReport()
  } catch (err) {
    failure = err
    if (!isMissingRepeatMistakeSchema(err)) console.error(err)
  }

  const parameters = [...new Map(rows.map((r) => [r.parameterId, r.parameterName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
  const selectedParam = parameters.some(([id]) => id === sp.parameter) ? sp.parameter : ''
  const visible = selectedParam ? rows.filter((r) => r.parameterId === selectedParam) : rows
  const sorted = [...visible].sort((a, b) => b.failCount - a.failCount || a.agentName.localeCompare(b.agentName))

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Repeat-Mistake Report</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Agents whose audits show the SAME rubric parameter failing repeatedly — flagged automatically the moment it
        fails in 3 of their last 5 audits on that parameter. Purely a count of what already happened, for spotting
        training-needs patterns — it never changes a score.
      </p>

      {failure ? (
        isMissingRepeatMistakeSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_049_capa_repeat_mistakes.sql</code> (after 048), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>The report could not be loaded right now. This does not mean there is nothing to show — try again shortly.</div>
        )
      ) : rows.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Nobody currently shows a repeat-mistake pattern — nothing has failed the same parameter 3 of the last 5 times.
        </div>
      ) : (
        <>
          <form method="get" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Parameter
              <select name="parameter" defaultValue={selectedParam} style={selectStyle}>
                <option value="">All parameters</option>
                {parameters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button type="submit" style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600, color: 'white', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
              Apply filter
            </button>
          </form>

          <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead>
                <tr>
                  <th style={th}>Agent</th>
                  <th style={th}>Parameter</th>
                  <th style={th}>Times failed</th>
                  <th style={th}>Status</th>
                  <th style={th}>First flagged</th>
                  <th style={th}>Last re-checked</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={`${r.agentId}:${r.parameterId}`}>
                    <td style={td}><b>{r.agentName}</b></td>
                    <td style={td}>{r.parameterName}</td>
                    <td style={td}>{r.failCount}</td>
                    <td style={td}>
                      <span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td style={td}>{formatDhakaDateTime(r.firstFlaggedAt)}</td>
                    <td style={td}>{r.lastCheckedAt ? formatDhakaDateTime(r.lastCheckedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
