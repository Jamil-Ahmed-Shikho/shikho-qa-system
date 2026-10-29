'use client'
// ============================================================
// SHIKHO QA SYSTEM — "Per-auditor progress" table, made expandable
// (2026-10-29, Jamil: QA Manager/Super Admin need the same "click a name,
// see their agents" drill-down a Manager already has for Team Leads, and a
// QA Auditor already has for themselves).
//
// The summary row (Agents/Audits done-target/Audit%/Coaching done-
// scheduled/Coaching%) is unchanged — still period-filtered, from
// qa_auditor_ranking() (Stage 1). Clicking it reveals the SAME
// AgentQueueTable every other agent-wise view in this app uses, sourced
// from qa_agent_queue()/ojt_candidates() grouped by quality_auditor_id
// (schema_103, auditor-queue-rollup.ts) — a current-state snapshot, not
// period-filtered, exactly like the Manager/Team-Lead drill-downs already
// are (the aggregate numbers above the fold are the only period-filtered
// part of this whole page).
// ============================================================

import { useState } from 'react'
import type { AuditorRankingRow } from '@/lib/qa-ranking/qa-ranking.service'
import { UNASSIGNED_AUDITOR_ID, type AuditorAgentGroup } from '@/lib/qa-ranking/auditor-queue-rollup'
import { AgentQueueTable } from '@/components/dashboard/AgentQueueTable'

const agentProfileHref = (id: string) => `/audits/agent/${id}/profile`
const auditAction = { label: 'Audit', href: (id: string) => `/audits/agent/${id}` }

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

export function AuditorProgressBreakdown({ rows, groups }: { rows: AuditorRankingRow[]; groups: AuditorAgentGroup[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const byAuditorId = new Map(groups.map((g) => [g.auditorId, g]))
  const unassigned = byAuditorId.get(UNASSIGNED_AUDITOR_ID)

  if (rows.length === 0 && !unassigned) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nothing to show for this period.</p>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
        <thead>
          <tr>
            <th style={th} />
            <th style={th}>Auditor</th>
            <th style={th}>Agents</th>
            <th style={th}>Audits done / target</th>
            <th style={th}>Audit %</th>
            <th style={th}>Coaching done / scheduled</th>
            <th style={th}>Coaching %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <AuditorRow key={r.auditorId} isOpen={open.has(r.auditorId)} onToggle={() => toggle(r.auditorId)} group={byAuditorId.get(r.auditorId)}>
              <td style={td}><b>{r.auditorName}</b></td>
              <td style={td}>{r.agentsAssigned}</td>
              <td style={td}>{r.auditsDone} / {r.auditTarget}</td>
              <td style={td}>{pct(r.auditPct)}</td>
              <td style={td}>{r.coachingCompleted} / {r.coachingScheduled}</td>
              <td style={td}>{pct(r.coachingPct)}</td>
            </AuditorRow>
          ))}
          {unassigned && (unassigned.rankedAgents.length > 0 || unassigned.reTraining.length > 0) && (
            <AuditorRow isOpen={open.has(UNASSIGNED_AUDITOR_ID)} onToggle={() => toggle(UNASSIGNED_AUDITOR_ID)} group={unassigned}>
              <td style={td}>
                <b>Unassigned</b>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No QA Auditor set on these agents&apos; profile</div>
              </td>
              <td style={td}>{unassigned.rankedAgents.length}</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
            </AuditorRow>
          )}
        </tbody>
      </table>
    </div>
  )
}

function AuditorRow({
  isOpen, onToggle, group, children,
}: {
  isOpen: boolean
  onToggle: () => void
  group: AuditorAgentGroup | undefined
  children: React.ReactNode
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={td}><span style={{ display: 'inline-block', width: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span></td>
        {children}
      </tr>
      {isOpen && (
        <tr>
          {/* width:1px — without it, a colSpan cell containing a wide independently-scrolling
           *  table makes the OUTER table's own columns blow out to match, so scrolling right to
           *  see the inner table's data columns also drags the outer summary row's own name
           *  column out of view (the exact bug Jamil reported — names cut off mid-word). This
           *  keeps the cell's rendered width to what the other (narrower) rows actually need,
           *  letting the inner table's own overflow-x:auto scroll independently instead. */}
          <td colSpan={7} style={{ padding: '10px 10px 10px 26px', background: 'var(--surface-0)', width: '1px' }}>
            <AgentQueueTable
              ranked={group?.rankedAgents ?? []}
              reTraining={group?.reTraining ?? []}
              agentProfileHref={agentProfileHref}
              action={auditAction}
              emptyMessage="No agents currently assigned to this auditor."
            />
          </td>
        </tr>
      )}
    </>
  )
}
