import type { TlCheckCallRow } from '@/lib/team-lead-checks/call-browser.service'
import { formatCrmDateTime, formatDhakaDateTime } from '@/lib/dates/format'

const td: React.CSSProperties = { padding: '10px 8px', fontSize: '13px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)', verticalAlign: 'middle' }
const btn: React.CSSProperties = { padding: '7px 14px', fontSize: '13px', fontWeight: 500, border: 'none', borderRadius: 'var(--radius-sm)', textDecoration: 'none', cursor: 'pointer', display: 'inline-block' }

export function TlCheckCallBrowserList({ rows, agentId }: { rows: TlCheckCallRow[]; agentId: string }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No calls match these filters.</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
        <thead>
          <tr>
            <th style={{ ...td, borderTop: 'none', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>When</th>
            <th style={{ ...td, borderTop: 'none', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>Lead</th>
            <th style={{ ...td, borderTop: 'none', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>Distribution List</th>
            <th style={{ ...td, borderTop: 'none', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>Duration</th>
            <th style={{ ...td, borderTop: 'none' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const seconds = r.call.duration ?? 0
            const duration = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—'
            return (
              <tr key={r.call.id}>
                <td style={td}>{formatCrmDateTime(r.call.started_at)}</td>
                <td style={td}>Lead {r.call.lead_id}</td>
                <td style={td}>
                  {r.distributionList === undefined ? (
                    <span style={{ color: 'var(--alert)' }} title="Could not load this lead's distribution list.">couldn&apos;t load</span>
                  ) : r.distributionList === null ? (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  ) : r.distributionList}
                </td>
                <td style={td}>{duration}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {r.status ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }} title={formatDhakaDateTime(r.status.createdAt)}>Checked</span>
                  ) : (
                    <a href={`/tl-checks/new?agent=${agentId}&lead=${r.call.lead_id}&call=${r.call.id}`} style={{ ...btn, color: '#fff', background: 'var(--brand)' }}>
                      Log a Check
                    </a>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
