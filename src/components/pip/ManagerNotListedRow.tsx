'use client'
// §6.4, Stage 3: a Manager requesting that someone NOT currently on the list be included. This is
// the same request mechanism as ManagerReviewRow's Exclude/Include, just for an agent who has no
// pip_candidates row at all yet — pip_request_change() handles both the same way.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestChangeAction } from '@/lib/pip/actions'
import type { PipNotListedAgent } from '@/lib/pip/pip.service'
import { ghostBtn, inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function ManagerNotListedRow({ cycleId, agent }: { cycleId: string; agent: PipNotListedAgent }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  function submit() {
    setError(null)
    if (!reason.trim()) return setError('A reason is required.')
    start(async () => {
      const res = await requestChangeAction(cycleId, agent.agentId, 'include', reason)
      if (!res.ok) return setError(res.error)
      setOpen(false); setReason(''); setSent(true)
      router.refresh()
    })
  }

  return (
    <tr>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)' }}>
        <b>{agent.agentName}</b>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[agent.teamName, agent.siteName].filter(Boolean).join(' · ')}</div>
      </td>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)', minWidth: '220px' }}>
        {sent ? (
          <span style={{ fontSize: '12px', color: 'var(--highlight)' }}>Your include request is pending</span>
        ) : open ? (
          <div style={{ display: 'grid', gap: '6px' }}>
            <textarea style={{ ...inputStyle, minHeight: '50px' }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={submit}>Request Include</button>
              <button style={ghostBtn} disabled={busy} onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
            </div>
            {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
          </div>
        ) : (
          <button style={ghostBtn} onClick={() => setOpen(true)}>Request Include…</button>
        )}
      </td>
    </tr>
  )
}
