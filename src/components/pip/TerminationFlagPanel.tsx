'use client'
// §6.4, Stage 5: a termination-review flag on a candidate that failed its 2nd+ CONSECUTIVE PIP.
// Read-only for QA; a Manager (own chain, via RLS) can record ONE exception -- dismiss it, or
// explicitly request another chance -- a record for the trail, never a direct edit of the flag or
// the candidate (the system only flags, it never auto-executes anything here, §6.4).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordTerminationExceptionAction } from '@/lib/pip/actions'
import type { PipTerminationFlag } from '@/lib/pip/pip.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { card } from '@/components/pip/pip-display'
import { ghostBtn, inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function TerminationFlagPanel({ candidateId, flag, canAct }: { candidateId: string; flag: PipTerminationFlag; canAct: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'dismissed' | 'another_chance'>(null)
  const [reason, setReason] = useState('')
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(type: 'dismissed' | 'another_chance') {
    setError(null)
    if (!reason.trim()) return setError('A reason is required.')
    start(async () => {
      const res = await recordTerminationExceptionAction(flag.id, candidateId, type, reason)
      if (!res.ok) return setError(res.error)
      setMode(null); setReason('')
      router.refresh()
    })
  }

  return (
    <div style={{ ...card, marginBottom: '16px', borderColor: 'var(--alert)', fontSize: '13px' }}>
      <b style={{ color: 'var(--alert)' }}>Flagged for termination review</b> — the {flag.consecutiveCountAtFlag}
      {flag.consecutiveCountAtFlag === 2 ? 'nd' : flag.consecutiveCountAtFlag === 3 ? 'rd' : 'th'} consecutive failed
      PIP, {formatDhakaDateTime(flag.flaggedAt)}. The system only flags this — HR/Manager decide and act outside this system.

      {flag.exceptionType ? (
        <div style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
          <b>{flag.exceptionType === 'dismissed' ? 'Dismissed' : 'Another chance requested'}</b>
          {flag.exceptionByName && <> by {flag.exceptionByName}</>}{flag.exceptionAt && <> — {formatDhakaDateTime(flag.exceptionAt)}</>}
          {flag.exceptionReason && <div>“{flag.exceptionReason}”</div>}
        </div>
      ) : canAct ? (
        <div style={{ marginTop: '10px' }}>
          {mode === null ? (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button style={ghostBtn} onClick={() => setMode('dismissed')}>Dismiss the flag…</button>
              <button style={ghostBtn} onClick={() => setMode('another_chance')}>Request another chance…</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '6px' }}>
              <textarea style={{ ...inputStyle, minHeight: '50px' }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => submit(mode)}>
                  {mode === 'dismissed' ? 'Confirm dismiss' : 'Confirm another chance'}
                </button>
                <button style={ghostBtn} disabled={busy} onClick={() => { setMode(null); setError(null) }}>Cancel</button>
              </div>
              {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '8px', color: 'var(--text-muted)' }}>Awaiting the agent's Manager to record a decision.</div>
      )}
    </div>
  )
}
