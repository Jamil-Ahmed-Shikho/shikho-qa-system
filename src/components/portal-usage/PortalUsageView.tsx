'use client'
// Portal Usage report — collapsible Team-Lead-style groups, same interaction and visual pattern as
// the Manager Dashboard's "By Team Lead" / "By Channel" tables (Jamil, 2026-11-04: "We have use this
// format in Manager dashboard... the ux design and brand guideline seems not maintained"). Card
// tiles, caret rows, sticky first column and the th/td tokens below are deliberately copied from
// ManagerDashboardView.tsx rather than imported — the data shape here (usage status counts, not
// audit/score metrics) is different enough that sharing the component would mean bending it to fit
// two unrelated metric sets (§14's "duplicate the small piece a new caller needs").

import { useState } from 'react'
import type { PortalUsageRow, PortalUsageStatus } from '@/lib/portal-usage/portal-usage.service'

const STATUS_LABEL: Record<PortalUsageStatus, string> = { active: 'Active', low_usage: 'Low usage', inactive: 'Inactive', never: 'Never logged in' }
const STATUS_COLOR: Record<PortalUsageStatus, string> = { active: 'var(--status-green)', low_usage: 'var(--highlight)', inactive: 'var(--alert)', never: 'var(--text-muted)' }
// Worst-first, so the people most worth a look sit at the top of each group.
const STATUS_RANK: Record<PortalUsageStatus, number> = { never: 0, inactive: 1, low_usage: 2, active: 3 }
const ROLE_LABEL: Record<string, string> = { super_admin: 'Super Admin', qa_manager: 'QA Manager', manager: 'Manager', team_lead: 'Team Lead', qa_auditor: 'QA Auditor' }
const ROLE_ORDER = ['super_admin', 'qa_manager', 'manager', 'team_lead', 'qa_auditor']

function StatusBadge({ status }: { status: PortalUsageStatus }) {
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      borderStyle: 'solid', borderWidth: '1px', borderColor: STATUS_COLOR[status], color: STATUS_COLOR[status],
    }}>{STATUS_LABEL[status]}</span>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

interface Counts { active: number; low_usage: number; inactive: number; never: number }
function statusCounts(rows: PortalUsageRow[]): Counts {
  const c: Counts = { active: 0, low_usage: 0, inactive: 0, never: 0 }
  for (const r of rows) c[r.status]++
  return c
}

interface UsageGroup {
  key: string
  label: string
  sub: string | null
  rows: PortalUsageRow[]
}

function groupRows(rows: PortalUsageRow[], scope: 'back_office' | 'frontline'): UsageGroup[] {
  if (scope === 'back_office') {
    const byRole = new Map<string, PortalUsageRow[]>()
    for (const r of rows) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r])
    return ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => ({ key: r, label: ROLE_LABEL[r] ?? r, sub: null, rows: byRole.get(r)! }))
  }
  const byLead = new Map<string, PortalUsageRow[]>()
  for (const r of rows) {
    const key = r.teamLeaderName ?? 'No Team Lead on record'
    byLead.set(key, [...(byLead.get(key) ?? []), r])
  }
  return [...byLead.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, leadRows]) => ({
      key: name, label: name,
      sub: [leadRows[0].teamName, leadRows[0].siteName].filter(Boolean).join(' · ') || null,
      rows: leadRows,
    }))
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function CountCells({ c }: { c: Counts }) {
  const right = { ...td, textAlign: 'right' as const }
  return (
    <>
      <td style={{ ...right, color: STATUS_COLOR.active, fontWeight: c.active ? 600 : undefined }}>{c.active}</td>
      <td style={{ ...right, color: STATUS_COLOR.low_usage, fontWeight: c.low_usage ? 600 : undefined }}>{c.low_usage}</td>
      <td style={{ ...right, color: STATUS_COLOR.inactive, fontWeight: c.inactive ? 600 : undefined }}>{c.inactive}</td>
      <td style={{ ...right, color: 'var(--text-muted)' }}>{c.never}</td>
    </>
  )
}

function DetailTable({ rows, showQaAuditorCol }: { rows: PortalUsageRow[]; showQaAuditorCol: boolean }) {
  const sorted = [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: showQaAuditorCol ? '680px' : '560px' }}>
        <thead>
          <tr>
            <th style={innerTh}>{showQaAuditorCol ? 'Agent' : 'Name'}</th>
            {showQaAuditorCol && <th style={innerTh}>QA Auditor</th>}
            <th style={innerTh}>Team / Site</th>
            <th style={innerTh}>Last active</th>
            <th style={innerTh}>Active (7d)</th>
            <th style={innerTh}>Active (30d)</th>
            <th style={innerTh}>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.userId}>
              <td style={{ ...innerTd, fontWeight: 600 }}>{r.name}</td>
              {showQaAuditorCol && <td style={innerTd}>{r.qualityAuditorName ?? '—'}</td>}
              <td style={innerTd}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
              <td style={innerTd}>{fmtDate(r.lastActiveDate)}{r.daysSinceActive !== null && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.daysSinceActive === 0 ? 'today' : `${r.daysSinceActive}d ago`}</div>}</td>
              <td style={innerTd}>{r.activeDays7} / 7</td>
              <td style={innerTd}>{r.activeDays30} / 30</td>
              <td style={innerTd}><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ group, isOpen, onToggle, hasSubColumn, showQaAuditorCol, colSpan }: {
  group: UsageGroup; isOpen: boolean; onToggle: () => void; hasSubColumn: boolean; showQaAuditorCol: boolean; colSpan: number
}) {
  const counts = statusCounts(group.rows)
  return (
    <>
      <tr onClick={onToggle} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
        <td style={{ ...td, ...stickyFirstCol('var(--paper)') }}>
          <span style={{ display: 'inline-block', width: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
          <b>{group.label}</b>
        </td>
        {hasSubColumn && <td style={td}>{group.sub ?? '—'}</td>}
        <td style={{ ...td, textAlign: 'right' }}>{group.rows.length}</td>
        <CountCells c={counts} />
      </tr>
      {isOpen && (
        <tr>
          {/* width:1px keeps this cell to what the other rows need, so the inner table scrolls on
           *  its own instead of blowing out the outer table's columns (same trick as ManagerDashboardView). */}
          <td colSpan={colSpan} style={{ padding: '10px 10px 10px 26px', background: 'var(--surface-0)', width: '1px' }}>
            <DetailTable rows={group.rows} showQaAuditorCol={showQaAuditorCol} />
          </td>
        </tr>
      )}
    </>
  )
}

function Section({
  title, note, rows, scope, groupColumnLabel, subColumnLabel, countColumnLabel,
}: {
  title: string
  note: string
  rows: PortalUsageRow[]
  scope: 'back_office' | 'frontline'
  groupColumnLabel: string
  subColumnLabel: string | null
  countColumnLabel: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const groups = groupRows(rows, scope)
  const totals = statusCounts(rows)
  const hasSubColumn = subColumnLabel !== null
  const colCount = (hasSubColumn ? 2 : 1) + 1 + 4 // name(+sub) + count + 4 status columns
  const headers = [groupColumnLabel, ...(hasSubColumn ? [subColumnLabel as string] : []), countColumnLabel, 'Active', 'Low usage', 'Inactive', 'Never']

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px', maxWidth: '680px' }}>{note}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <Card label="Tracked" value={String(rows.length)} />
        <Card label="Active" value={String(totals.active)} color={STATUS_COLOR.active} />
        <Card label="Low usage" value={String(totals.low_usage)} color={STATUS_COLOR.low_usage} />
        <Card label="Inactive" value={String(totals.inactive)} color={totals.inactive > 0 ? STATUS_COLOR.inactive : undefined} />
        <Card label="Never logged in" value={String(totals.never)} />
      </div>

      {rows.length === 0 ? (
        <div style={emptyBox}>Nobody in view right now.</div>
      ) : (
        <div style={{ overflowX: 'auto', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
            <thead>
              <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
                {headers.map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i >= (hasSubColumn ? 2 : 1) ? 'right' : 'left', ...(i === 0 ? stickyFirstCol('var(--surface-1)') : {}) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.key} group={g} isOpen={open.has(g.key)} onToggle={() => toggle(g.key)} hasSubColumn={hasSubColumn} showQaAuditorCol={scope === 'frontline'} colSpan={colCount} />
              ))}
              <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--surface-0)', fontWeight: 600 }}>
                <td style={{ ...td, ...stickyFirstCol('var(--surface-0)') }} colSpan={hasSubColumn ? 2 : 1}>Total</td>
                <td style={{ ...td, textAlign: 'right' }}>{rows.length}</td>
                <CountCells c={totals} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
        Click a row to see the people in it. Sorted worst-status-first within each group.
      </p>
    </div>
  )
}

export function PortalUsageView({ backOffice, frontline }: { backOffice: PortalUsageRow[]; frontline: PortalUsageRow[] }) {
  return (
    <div>
      <Section
        title="Back Office usage"
        note="QA, Team Lead, Manager and Admin accounts — are they actually signing in and using the portal?"
        rows={backOffice}
        scope="back_office"
        groupColumnLabel="Role"
        subColumnLabel={null}
        countColumnLabel="People"
      />
      <Section
        title="Frontline usage"
        note="Agents, grouped by Team Lead — are they actually using the portal (coaching, their own result emails, etc.)?"
        rows={frontline}
        scope="frontline"
        groupColumnLabel="Team Lead"
        subColumnLabel="Team / Site"
        countColumnLabel="Agents"
      />
    </div>
  )
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '12px', color: 'var(--text-secondary)' }
const td: React.CSSProperties = { padding: '10px 12px' }
const innerTh: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const innerTd: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const stickyFirstCol = (bg: string): React.CSSProperties => ({ position: 'sticky', left: 0, background: bg, zIndex: 1, boxShadow: '2px 0 4px -2px rgba(15, 19, 34, 0.12)' })
const emptyBox: React.CSSProperties = {
  background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '24px', color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', lineHeight: 1.6,
}
