// The Campaign Report body: a summary line, then one card per check — a
// table (count + %) and a simple bar chart. Server-safe (no 'use client'):
// every number here is exactly what CampaignReportResult already computed.

import type { CampaignReportResult, ReportCheck } from '@/lib/campaigns/report.service'

export const selectStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--text-primary)',
  background: 'var(--surface-2)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border-strong)',
  borderRadius: 'var(--radius-sm)', minWidth: '150px',
}

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px',
}

const pct = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0)

export function CampaignReportView({ report }: { report: CampaignReportResult }) {
  return (
    <div>
      <section style={{ ...card, marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>{report.campaignName}</h2>
          {report.campaignArchived && (
            <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>
              Archived
            </span>
          )}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
          <b>{report.auditCount}</b> submitted audit{report.auditCount === 1 ? '' : 's'} matching the current filters had this campaign attached.
        </p>
      </section>

      {report.checks.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          This campaign has no checks.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {report.checks.map((check) => <CheckCard key={check.checkTypeId} check={check} />)}
      </div>
    </div>
  )
}

function CheckCard({ check }: { check: ReportCheck }) {
  const max = Math.max(1, ...check.options.map((o) => o.count))

  return (
    <section style={{ ...card }} aria-label={`Distribution for: ${check.name}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, overflowWrap: 'anywhere' }}>
          {check.name}
          {check.archived && (
            <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>
              Archived
            </span>
          )}
        </h3>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{check.total} answer{check.total === 1 ? '' : 's'}</span>
      </div>

      {check.total === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>No answers yet for the current filters.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {check.options.map((o) => (
            <div key={o.valueId} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr auto', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                {o.label}
                {o.archived && <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>(archived)</span>}
              </span>
              <div
                role="img"
                aria-label={`${o.count} of ${check.total} (${pct(o.count, check.total)}%)`}
                style={{ height: '16px', background: 'var(--surface-1)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}
              >
                <div style={{ width: `${(o.count / max) * 100}%`, height: '100%', background: o.count > 0 ? 'var(--brand)' : 'transparent', borderRadius: 'var(--radius-pill)', transition: 'width 0.2s' }} />
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {o.count} · {pct(o.count, check.total)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
