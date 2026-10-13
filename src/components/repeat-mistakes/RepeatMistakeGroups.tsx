'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { STATUS_LABEL, type RepeatMistakeRow } from '@/lib/repeat-mistakes/labels'

/** A row, plus the agent-profile link precomputed server-side — functions can't cross the
 * server/client boundary as props, so the href is built once on the server instead. */
export interface RepeatMistakeGroupRow extends RepeatMistakeRow {
  agentHref: string
}

export interface RepeatMistakeGroup {
  key: string
  label: string
  /** Set only for an agent group (By agent) — makes the header label itself a link to their profile. */
  labelHref: string | null
  subLabel: string | null
  rows: RepeatMistakeGroupRow[]
}

const STATUS_COLOR: Record<RepeatMistakeRow['status'], string> = {
  still_failing: 'var(--alert)',
  improved: 'var(--status-green)',
  not_yet_rechecked: 'var(--text-muted)',
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '7px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '8px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const groupHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)' }

function StatusChips({ rows }: { rows: RepeatMistakeRow[] }) {
  const counts = { still_failing: 0, improved: 0, not_yet_rechecked: 0 }
  for (const r of rows) counts[r.status]++
  return (
    <span style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
      {counts.still_failing > 0 && <span style={{ color: STATUS_COLOR.still_failing, fontWeight: 600 }}>{counts.still_failing} still failing</span>}
      {counts.not_yet_rechecked > 0 && <span style={{ color: STATUS_COLOR.not_yet_rechecked }}>{counts.not_yet_rechecked} not re-checked</span>}
      {counts.improved > 0 && <span style={{ color: STATUS_COLOR.improved }}>{counts.improved} improved</span>}
    </span>
  )
}

/** One expandable section (By Parameter, or By Agent) — same collapsible-group pattern the Manager
 * dashboard already uses for its By Team Lead / By Channel tables (src/components/dashboard/manager). */
function GroupSection({
  title, note, groups, agentColumnLabel,
}: {
  title: string
  note: string
  groups: RepeatMistakeGroup[]
  /** The column header for the "other" dimension — "Agent" in By Parameter, "Parameter" in By Agent. */
  agentColumnLabel: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set(groups.length > 0 ? [groups[0].key] : []))
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div style={{ marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>{note}</p>
      {groups.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nothing matches the current filters.</p>
      ) : (
        <div style={{ display: 'grid', gap: '6px' }}>
          {groups.map((g) => {
            const isOpen = open.has(g.key)
            return (
              <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)' }}>
                <div style={groupHeader} onClick={() => toggle(g.key)}>
                  <span style={{ width: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                  <b style={{ fontSize: '14px' }}>
                    {g.labelHref
                      ? <Link href={g.labelHref} prefetch={false} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--brand)', textDecoration: 'none' }}>{g.label}</Link>
                      : g.label}
                  </b>
                  {g.subLabel && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{g.subLabel}</span>}
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>· {g.rows.length} {g.rows.length === 1 ? 'row' : 'rows'}</span>
                  <span style={{ marginLeft: 'auto' }}><StatusChips rows={g.rows} /></span>
                </div>
                {isOpen && (
                  <div style={{ overflowX: 'auto', padding: '0 4px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
                      <thead>
                        <tr>
                          <th style={th}>{agentColumnLabel}</th>
                          <th style={th}>Team / Site</th>
                          <th style={th}>Times failed</th>
                          <th style={th}>Status</th>
                          <th style={th}>First flagged</th>
                          <th style={th}>Last re-checked</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={`${r.agentId}:${r.parameterId}`}>
                            <td style={td}>
                              {agentColumnLabel === 'Agent'
                                ? <Link href={r.agentHref} prefetch={false} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>{r.agentName}</Link>
                                : r.parameterName}
                            </td>
                            <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}{r.teamLeaderName ? <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>TL: {r.teamLeaderName}</div> : null}</td>
                            <td style={td}>{r.failCount}</td>
                            <td style={td}><span style={{ color: STATUS_COLOR[r.status], fontWeight: 600 }}>{STATUS_LABEL[r.status]}</span></td>
                            <td style={td}>{formatDhakaDateTime(r.firstFlaggedAt)}</td>
                            <td style={td}>{r.lastCheckedAt ? formatDhakaDateTime(r.lastCheckedAt) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function RepeatMistakeGroups({
  byParameter, byAgent,
}: {
  byParameter: RepeatMistakeGroup[]
  byAgent: RepeatMistakeGroup[]
}) {
  return (
    <div>
      <GroupSection
        title="By parameter"
        note="Ranked by how many people it's affecting — the widest training gaps first."
        groups={byParameter}
        agentColumnLabel="Agent"
      />
      <GroupSection
        title="By agent"
        note="Everyone with a repeat-mistake pattern, grouped so you can see everything one person needs coaching on at once."
        groups={byAgent}
        agentColumnLabel="Parameter"
      />
    </div>
  )
}
