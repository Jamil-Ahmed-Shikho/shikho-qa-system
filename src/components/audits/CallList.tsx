'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startAudit, releaseDraft } from '@/lib/audits/actions'
import type { CrmCallingHistory } from '@/lib/crm/types'
import type { CallStatusEntry } from '@/lib/audits/audits.service'
import type { AgentMatch } from '@/lib/audits/agent-matching'
import { describeUnmatched, type CrmAgentInfo } from '@/lib/audits/crm-agent'

export interface CallRow {
  call: CrmCallingHistory
  status: CallStatusEntry | null
  matchedAgent: AgentMatch | null
  /** What the CRM reported about the agent (used when matchedAgent is null). */
  crmAgent: CrmAgentInfo
  /** Set only for Team Leads: this call wasn't taken by an agent on their team. */
  outsideTeam?: boolean
}

interface AgentOption {
  id: string
  name: string
  email: string
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  available: { label: 'Available', bg: 'var(--surface-1)', color: 'var(--text-muted)' },
  in_progress_mine: { label: 'In progress (you)', bg: 'var(--brand-light)', color: 'var(--brand)' },
  taken: { label: 'Taken', bg: 'var(--highlight-light)', color: 'var(--highlight)' },
  audited: { label: 'Audited', bg: '#E5F5EC', color: 'var(--status-green)' },
}

export function CallList({
  rows,
  leadId,
  agentOptions,
  canManageUsers,
}: {
  rows: CallRow[]
  leadId: string
  agentOptions: AgentOption[]
  canManageUsers: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {agentOptions.length === 0 && (
        <div style={{
          background: 'var(--highlight-light)', border: '1px solid var(--highlight)',
          borderRadius: 'var(--radius-md)', padding: '14px 16px', fontSize: '13px', color: 'var(--text-primary)',
        }}>
          No agents exist yet, so there is nobody to attach an audit to.{' '}
          {canManageUsers ? (
            <a href="/admin/users" style={{ color: 'var(--brand)', fontWeight: 600 }}>Add agents in Users</a>
          ) : (
            'Ask a QA Manager or Super Admin to add agents.'
          )}
        </div>
      )}
      {rows.map((row) => (
        <CallRowItem key={row.call.id} row={row} leadId={leadId} agentOptions={agentOptions} canManageUsers={canManageUsers} />
      ))}
    </div>
  )
}

function CallRowItem({
  row,
  leadId,
  agentOptions: baseAgentOptions,
  canManageUsers,
}: {
  row: CallRow
  leadId: string
  agentOptions: AgentOption[]
  canManageUsers: boolean
}) {
  const router = useRouter()
  const { call, status, matchedAgent } = row
  // The dropdown only exists for calls we could NOT match to a user (a
  // human has to pick someone). A matched call shows its agent as fixed
  // text and the server attaches the audit to that person regardless.
  const agentOptions = baseAgentOptions
  const [selectedAgentId, setSelectedAgentId] = useState(matchedAgent?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const statusKey = status?.status ?? 'available'
  const badge = STATUS_STYLE[statusKey]
  // Team Leads audit only their own team's calls (the server enforces it
  // too — this just says so up front instead of failing on click).
  const locked = !!row.outsideTeam && statusKey === 'available'

  const started = new Date(call.started_at)
  const ended = new Date(call.ended_at)
  const durationSec = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000))
  const duration = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`

  function handleStart() {
    if (!selectedAgentId) {
      setError('Select the agent this call belongs to first.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const auditId = await startAudit(leadId, call.id, selectedAgentId)
        router.push(`/audits/${auditId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the audit.')
      }
    })
  }

  function handleRelease() {
    if (!status) return
    setError(null)
    startTransition(async () => {
      try {
        await releaseDraft(status.auditId, leadId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not release this draft.')
      }
    })
  }

  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{started.toLocaleString()}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {duration}
            {(call.destination_number ?? call.destination) && ` · ${call.destination_number ?? call.destination}`}
            {' · '}{call.call_status}
          </div>
        </div>
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)',
          background: badge.bg, color: badge.color,
        }}>
          {badge.label}{status?.auditorName && statusKey !== 'in_progress_mine' ? ` · ${status.auditorName}` : ''}
        </span>
      </div>

      {error && (
        <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--alert)' }}>{error}</div>
      )}

      <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Agent:</label>
        {matchedAgent ? (
          <span style={{ fontSize: '13px', overflowWrap: 'anywhere' }}>
            <b>{matchedAgent.name}</b>{' '}
            <span style={{ color: 'var(--text-muted)' }}>({matchedAgent.email})</span>
          </span>
        ) : (
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            disabled={statusKey !== 'available' || locked}
            style={{
              padding: '7px 10px', fontSize: '13px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text-primary)',
              minWidth: '220px',
            }}
          >
            <option value="">— Select agent —</option>
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.email})
              </option>
            ))}
          </select>
        )}
        {!locked && matchedAgent && statusKey === 'available' && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            auto-matched by {matchedAgent.matchedBy === 'crm_agent_id' ? 'cached CRM id' : 'email'}
          </span>
        )}
        {!locked && !matchedAgent && statusKey === 'available' && !selectedAgentId && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {agentOptions.length === 0 ? 'no agents available to select' : 'select the agent to enable Start Audit'}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {statusKey === 'available' && !locked && (
            <button
              onClick={handleStart}
              disabled={pending || !selectedAgentId}
              title={!selectedAgentId ? 'Select the agent this call belongs to first' : undefined}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500,
                color: !selectedAgentId || pending ? 'var(--text-muted)' : 'white',
                background: !selectedAgentId || pending ? 'var(--surface-1)' : 'var(--brand)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: !selectedAgentId || pending ? 'not-allowed' : 'pointer',
              }}
            >
              {pending ? 'Starting...' : 'Start Audit'}
            </button>
          )}
          {statusKey === 'in_progress_mine' && status && (
            <>
              <a
                href={`/audits/${status.auditId}`}
                style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: 500, color: 'white',
                  background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
                }}
              >
                Continue
              </a>
              <button
                onClick={handleRelease}
                disabled={pending}
                style={{
                  padding: '8px 12px', fontSize: '13px', color: 'var(--alert)', background: 'var(--alert-light)',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: pending ? 'not-allowed' : 'pointer',
                }}
              >
                Release
              </button>
            </>
          )}
          {(statusKey === 'taken' || statusKey === 'audited') && status && (
            <a
              href={`/audits/${status.auditId}`}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500, color: 'var(--brand)',
                background: 'var(--brand-light)', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
              }}
            >
              View
            </a>
          )}
        </div>
      </div>

      {/* Who the CRM says took this call — shown whenever we couldn't tie
          it to one of our users (or a Team Lead can't act on it), so QA
          knows exactly who to look for, or that they need a profile. */}
      {statusKey === 'available' && (locked || !matchedAgent) && (
        <CrmSaysNote crm={row.crmAgent} locked={locked} canManageUsers={canManageUsers} />
      )}
    </div>
  )
}

function CrmSaysNote({ crm, locked, canManageUsers }: { crm: CrmAgentInfo; locked: boolean; canManageUsers: boolean }) {
  const d = describeUnmatched(crm)
  return (
    <div style={{
      marginTop: '12px', padding: '8px 12px', fontSize: '12px', lineHeight: 1.6,
      background: 'var(--highlight-light)', borderLeft: '3px solid var(--highlight)',
      borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', overflowWrap: 'anywhere',
    }}>
      {d.crmSays && (
        <>
          CRM says: <b style={{ color: 'var(--text-primary)' }}>{d.crmSays}</b>
          {' — '}
        </>
      )}
      {locked
        ? "not taken by an agent on your team; you can only audit your own team's calls"
        : d.note}
      {!locked && d.kind === 'no_profile' && canManageUsers && (
        <>
          {' · '}
          <a href="/admin/users" style={{ color: 'var(--brand)', fontWeight: 600 }}>Add them in Users</a>
        </>
      )}
    </div>
  )
}
