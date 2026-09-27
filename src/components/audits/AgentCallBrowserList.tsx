'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startAudit, releaseDraft } from '@/lib/audits/actions'
import type { AgentCallRow } from '@/lib/audits/agent-call-browser.service'
import { CallStatusPill } from './CallStatusPill'
import { formatCrmDateTime } from '@/lib/dates/format'

const td: React.CSSProperties = { padding: '10px 8px', fontSize: '13px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)', verticalAlign: 'middle' }
const btn: React.CSSProperties = { padding: '7px 14px', fontSize: '13px', fontWeight: 500, border: 'none', borderRadius: 'var(--radius-sm)', textDecoration: 'none', cursor: 'pointer' }

/**
 * The agent-scoped call browser's list (§9/§10, Part 2). Unlike CallList (one lead, an unknown agent per row),
 * every row here is a DIFFERENT lead but the SAME, already-known agent — so there is no "select the agent"
 * step; Start Audit always sends this agent's id as the fallback (the CRM match still decides authoritatively).
 */
export function AgentCallBrowserList({ rows, agentId, agentName }: { rows: AgentCallRow[]; agentId: string; agentName: string }) {
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
            <th style={{ ...td, borderTop: 'none', textAlign: 'left', fontSize: '11px', color: 'var(--text-muted)' }}>Status</th>
            <th style={{ ...td, borderTop: 'none' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.call.id} row={r} agentId={agentId} agentName={agentName} />)}
        </tbody>
      </table>
    </div>
  )
}

function Row({ row, agentId, agentName }: { row: AgentCallRow; agentId: string; agentName: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { call, status } = row
  const statusKey = status?.status ?? 'available'
  const seconds = call.duration ?? 0
  const duration = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—'

  function handleStart() {
    setError(null)
    setStarting(true)
    start(async () => {
      try {
        const auditId = await startAudit(call.lead_id, call.id, agentId)
        router.push(`/audits/${auditId}`)
      } catch (err) {
        setStarting(false)
        setError(err instanceof Error ? err.message : 'Could not start the audit.')
      }
    })
  }
  function handleRelease() {
    if (!status) return
    start(async () => {
      try {
        await releaseDraft(status.auditId, String(call.lead_id))
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not release the draft.')
      }
    })
  }

  return (
    <tr>
      <td style={td}>{formatCrmDateTime(call.started_at)}</td>
      <td style={td}>
        <a href={`/audits/leads/${call.lead_id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>Lead {call.lead_id}</a>
        {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '12px', marginTop: '4px' }}>{error}</div>}
      </td>
      <td style={td}>
        {row.distributionList === undefined ? (
          <span style={{ color: 'var(--alert)' }} title="Could not load this lead's distribution list.">couldn&apos;t load</span>
        ) : row.distributionList === null ? (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        ) : (
          row.distributionList
        )}
      </td>
      <td style={td}>{duration}</td>
      <td style={td}><CallStatusPill status={call.call_status} /></td>
      <td style={{ ...td, textAlign: 'right' }}>
        {statusKey === 'available' && (
          <button onClick={handleStart} disabled={starting || pending} aria-busy={starting || pending}
            title={`Start an audit for ${agentName} on this call`}
            style={{ ...btn, color: '#fff', background: 'var(--brand)', cursor: starting || pending ? 'progress' : 'pointer' }}>
            {starting || pending ? 'Starting…' : 'Start Audit'}
          </button>
        )}
        {statusKey === 'in_progress_mine' && status && (
          <span style={{ display: 'inline-flex', gap: '6px' }}>
            <a href={`/audits/${status.auditId}`} style={{ ...btn, color: '#fff', background: 'var(--brand)' }}>Continue</a>
            <button onClick={handleRelease} disabled={pending}
              style={{ ...btn, color: 'var(--alert)', background: 'var(--alert-light)', cursor: pending ? 'not-allowed' : 'pointer' }}>
              Release
            </button>
          </span>
        )}
        {(statusKey === 'taken' || statusKey === 'audited') && status && (
          <a href={`/audits/${status.auditId}`} style={{ ...btn, color: 'var(--brand)', background: 'var(--brand-light)' }}>
            {statusKey === 'taken' ? `Taken${status.auditorName ? ` · ${status.auditorName}` : ''}` : 'View'}
          </a>
        )}
      </td>
    </tr>
  )
}
