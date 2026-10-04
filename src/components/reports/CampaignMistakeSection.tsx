// ============================================================
// SHIKHO QA SYSTEM — Campaign Report: "who to take care of" (schema_077,
// 2026-10-04, Jamil's own request). Server-safe (no 'use client'): the
// checklist lives inside the report page's existing GET-form filter bar (so
// one "Apply filters" click updates both at once, no separate client state),
// the breakdown table below it.
// ============================================================

import Link from 'next/link'
import type { MistakeOption, MistakeRow } from '@/lib/campaigns/report.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const checkboxLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
}

/** Renders INSIDE the report's own <form method="get">, so picking which options count as a
 *  mistake takes effect together with every other filter on the same "Apply filters" click. */
export function MistakeFilterFields({ options, selectedValueIds }: { options: MistakeOption[]; selectedValueIds: string[] | null }) {
  if (options.length === 0) return null

  // Group by check, in the order options were first seen (already sorted by check/option order upstream).
  const byCheck = new Map<string, MistakeOption[]>()
  for (const o of options) {
    if (!byCheck.has(o.checkName)) byCheck.set(o.checkName, [])
    byCheck.get(o.checkName)!.push(o)
  }
  const isChecked = (valueId: string) => (selectedValueIds === null ? true : selectedValueIds.includes(valueId))

  return (
    <div style={{ flexBasis: '100%', paddingTop: '10px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
      {/* Marks this submission as having an explicit choice — even if every box ends up
          unchecked, a checkbox that's unchecked sends nothing, so without this marker an
          "I unchecked everything" submit would be indistinguishable from "never touched". */}
      <input type="hidden" name="mistakeFilterTouched" value="1" />
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>
        Count as a mistake
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[...byCheck.entries()].map(([checkName, opts]) => (
          <div key={checkName} style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'baseline' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '160px' }}>{checkName}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {opts.map((o) => (
                <label key={o.valueId} style={checkboxLabel}>
                  <input type="checkbox" name="mistakeValues" value={o.valueId} defaultChecked={isChecked(o.valueId)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export function MistakeBreakdownTable({
  options, rows, agentProfileHref, auditLinksEnabled,
}: {
  options: MistakeOption[]
  rows: MistakeRow[]
  /** Where an agent's name links to — `/audits/agent/{id}/profile` for QA/Team Lead, a Manager-scoped route for a Manager viewer. */
  agentProfileHref: (agentId: string) => string
  /** False for a Manager viewer, who can't open `/audits/{id}` (§9 Part 2) — the "last mistake" link is omitted, not rendered disabled. */
  auditLinksEnabled: boolean
}) {
  if (options.length === 0) {
    return (
      <section style={{ ...card, marginTop: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
        No options in this campaign are tagged as a mistake yet — tag one under &ldquo;Manage Special Checks&rdquo; to start tracking who to take care of.
      </section>
    )
  }

  return (
    <section style={{ ...card, marginTop: '20px' }}>
      <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>Who to take care of</h3>
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
        Agents who picked a mistake-tagged answer, worst first. &ldquo;Lifetime&rdquo; counts the same kind of mistake across every submitted audit, not just the current filters.
      </p>

      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>No mistakes matching the current filters.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr>
                <th style={{ ...th, borderTop: 'none' }}>Agent</th>
                <th style={{ ...th, borderTop: 'none' }}>Team Leader</th>
                <th style={{ ...th, borderTop: 'none' }}>In this view</th>
                <th style={{ ...th, borderTop: 'none' }}>Lifetime</th>
                <th style={{ ...th, borderTop: 'none' }}>Most recent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agentId}>
                  <td style={td}>
                    <Link href={agentProfileHref(r.agentId)} style={{ color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
                      {r.agentName}
                    </Link>
                  </td>
                  <td style={{ ...td, color: 'var(--text-secondary)' }}>{r.teamLeaderName ?? '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.mistakeCount}</td>
                  <td style={td}>
                    <span style={r.lifetimeCount >= 2 ? { color: 'var(--alert)', fontWeight: 700 } : undefined}>
                      {r.lifetimeCount}
                    </span>
                    {r.lifetimeCount >= 2 && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--alert-light)', color: 'var(--alert)' }}>
                        REPEAT
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, color: 'var(--text-secondary)' }}>
                    {r.lastMistakeAt ? (
                      <>
                        {formatDhakaDateTime(r.lastMistakeAt)}
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {r.lastCheckName} — {r.lastValueLabel}
                        </div>
                        {auditLinksEnabled && r.lastAuditId && (
                          <Link href={`/audits/${r.lastAuditId}`} style={{ fontSize: '11px', color: 'var(--brand)', textDecoration: 'none' }}>
                            View audit →
                          </Link>
                        )}
                      </>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
