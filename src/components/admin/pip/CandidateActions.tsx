'use client'
// The buttons for one candidate. What is offered follows the workflow the database enforces:
//   suggested -> Approve | Exclude (reason required)     excluded -> Restore
//   approved  -> Mark completed | Mark failed (optionally downgrade the incentive)
// completed / failed are final. Only a Super Admin / QA Manager sees this component's page at all.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { decideAction } from '@/lib/pip/actions'
import type { PipStatus } from '@/lib/pip/pip.service'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { dangerBtn, ghostBtn, inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

type Mode = null | 'exclude' | 'fail' | 'complete'

export function CandidateActions({ candidateId, cycleId, status, agentName }: { candidateId: string; cycleId: string; status: PipStatus; agentName: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [note, setNote] = useState('')
  const [downgrade, setDowngrade] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(mode !== null && note.trim() !== '')

  async function run(action: 'exclude' | 'restore' | 'approve' | 'complete' | 'fail', withNote: string | null = null) {
    setError(null)
    setBusy(true)
    const res = await decideAction(candidateId, cycleId, action, withNote, action === 'fail' ? downgrade : false)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setMode(null); setNote(''); setDowngrade(false)
    router.refresh()
  }

  if (status === 'completed' || status === 'failed') return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Final</span>

  const disabled = busy ? disabledStyle : {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px' }}>
      {mode === null && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {status === 'suggested' && (
            <>
              <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...disabled }} disabled={busy}
                onClick={() => { if (confirm(`Approve ${agentName} for this PIP? This puts them on a performance improvement plan.`)) run('approve') }}>Approve</button>
              <button style={{ ...ghostBtn, ...disabled }} disabled={busy} onClick={() => setMode('exclude')}>Exclude…</button>
            </>
          )}
          {status === 'excluded' && <button style={{ ...ghostBtn, ...disabled }} disabled={busy} onClick={() => run('restore')}>Restore to suggested</button>}
          {status === 'approved' && (
            <>
              <button style={{ ...ghostBtn, ...disabled }} disabled={busy} onClick={() => setMode('complete')}>Mark completed…</button>
              <button style={{ ...dangerBtn, ...disabled }} disabled={busy} onClick={() => setMode('fail')}>Mark failed…</button>
            </>
          )}
        </div>
      )}

      {mode !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <textarea
            aria-label={mode === 'exclude' ? 'Reason for excluding' : 'Note'}
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            placeholder={mode === 'exclude' ? 'Reason (required) — e.g. on approved leave' : 'Note (optional)'}
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
          />
          {mode === 'fail' && (
            <label style={{ fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input type="checkbox" checked={downgrade} onChange={(e) => setDowngrade(e.target.checked)} /> Incentive downgraded
            </label>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...disabled }} disabled={busy || (mode === 'exclude' && !note.trim())}
              onClick={() => run(mode, note.trim() || null)}>{busy ? 'Saving…' : 'Confirm'}</button>
            <button style={ghostBtn} disabled={busy} onClick={() => { setMode(null); setNote(''); setDowngrade(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
    </div>
  )
}
