'use client'
// §6.4, Stage 3: a Manager's own row on the pre-publish suggestion list. Requesting a change is
// never a direct edit — it waits for QA Manager / Super Admin to accept or reject it. A suggested
// row can be requested Excluded; an already-excluded row can be requested Included again
// (reconsidered) — either way it's the same request mechanism, just the opposite direction.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestChangeAction } from '@/lib/pip/actions'
import { fmtMoney } from '@/components/pip/pip-display'
import { describeVintageWeeks } from '@/lib/pip/validation'
import type { PipReviewRow } from '@/lib/pip/pip.service'
import { ghostBtn, inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function ManagerReviewRow({ cycleId, row }: { cycleId: string; row: PipReviewRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const already = row.myPendingRequestType
  const type: 'exclude' | 'include' = row.status === 'suggested' ? 'exclude' : 'include'
  const actionLabel = type === 'exclude' ? 'Request Exclude' : 'Request Include'

  function submit() {
    setError(null)
    if (!reason.trim()) return setError('A reason is required.')
    start(async () => {
      const res = await requestChangeAction(cycleId, row.agentId, type, reason)
      if (!res.ok) return setError(res.error)
      setOpen(false); setReason('')
      router.refresh()
    })
  }

  return (
    <tr>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)' }}>
        <b>{row.agentName}</b>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[row.teamName, row.siteName].filter(Boolean).join(' · ')}</div>
      </td>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)' }}>{fmtMoney(row.revenue, row.revenueUnit)}</td>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)' }}>{describeVintageWeeks(row.vintageWeeks)}</td>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)' }}>
        {row.status === 'excluded' ? <span style={{ color: 'var(--text-muted)' }}>Excluded{row.exclusionReason ? ` — ${row.exclusionReason}` : ''}</span> : 'Suggested'}
      </td>
      <td style={{ padding: '9px 10px', fontSize: '13px', borderTop: '1px solid var(--border)', minWidth: '220px' }}>
        {already ? (
          <span style={{ fontSize: '12px', color: 'var(--highlight)' }}>Your {already} request is pending</span>
        ) : open ? (
          <div style={{ display: 'grid', gap: '6px' }}>
            <textarea style={{ ...inputStyle, minHeight: '50px' }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={submit}>{actionLabel}</button>
              <button style={ghostBtn} disabled={busy} onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
            </div>
            {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
          </div>
        ) : (
          <button style={ghostBtn} onClick={() => setOpen(true)}>{actionLabel}…</button>
        )}
      </td>
    </tr>
  )
}
