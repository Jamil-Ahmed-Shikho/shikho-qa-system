// ============================================================
// SHIKHO QA SYSTEM — Campaign Mistake Report: "when we last sent this"
// (2026-10-08, Jamil's own request). Server-safe (no 'use client') — just
// renders rows already loaded server-side by loadMistakeReportSendLog().
// ============================================================

import { formatDhakaDateTime } from '@/lib/dates/format'
import type { MistakeReportSendLogEntry } from '@/lib/campaigns/mistake-report-actions'

const td: React.CSSProperties = { fontSize: '12.5px', padding: '7px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '10.5px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '5px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}

export function MistakeReportSendLog({ entries }: { entries: MistakeReportSendLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '10px' }}>
        This report has never been sent for this campaign yet.
      </p>
    )
  }

  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '6px' }}>
        Last {entries.length} time{entries.length === 1 ? '' : 's'} sent
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
          <thead>
            <tr>
              <th style={{ ...th, borderTop: 'none' }}>When</th>
              <th style={{ ...th, borderTop: 'none' }}>Sent by</th>
              <th style={{ ...th, borderTop: 'none' }}>Mode</th>
              <th style={{ ...th, borderTop: 'none' }}>To</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td style={td}>{formatDhakaDateTime(e.sentAt)}</td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>{e.sentByName}</td>
                <td style={td}>
                  {e.mode === 'test' ? (
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                      TEST
                    </span>
                  ) : (
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--brand-light)', color: 'var(--brand)' }}>
                      LIVE
                    </span>
                  )}
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>{e.to.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
