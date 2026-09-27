'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ojtTransitionAction } from '@/lib/ojt/actions'
import type { OjtCandidate, OjtTransitionTarget } from '@/lib/ojt/ojt.service'

const btn: React.CSSProperties = {
  padding: '6px 12px', fontSize: '12px', fontWeight: 500, borderRadius: 'var(--radius-sm)',
  borderWidth: '1px', borderStyle: 'solid', background: 'transparent', cursor: 'pointer',
}
const field: React.CSSProperties = {
  padding: '7px 10px', fontSize: '13px', borderRadius: 'var(--radius-sm)', borderWidth: '1px', borderStyle: 'solid',
  borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit', width: '100%',
}

const TODAY = new Date().toISOString().slice(0, 10)

type Mode = null | 'certify' | 're_training' | 'not_certified' | 'discontinued'

export function OjtCandidateActions({ candidate }: { candidate: OjtCandidate }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [note, setNote] = useState('')
  const [joiningDate, setJoiningDate] = useState(TODAY)
  const [retrainStart, setRetrainStart] = useState(TODAY)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setMode(null); setNote(''); setJoiningDate(TODAY); setRetrainStart(TODAY); setError(null)
  }

  function submit(to: OjtTransitionTarget) {
    setError(null)
    if ((to === 'not_certified' || to === 'discontinued') && !note.trim()) {
      return setError('A reason is required.')
    }
    const confirmMsg =
      to === 'active' ? `Certify ${candidate.name}? This makes them an active agent from ${joiningDate}.`
      : to === 're_training' ? `Move ${candidate.name} into re-training starting ${retrainStart} (a 3-day window)?`
      : to === 'not_certified' ? `Mark ${candidate.name} as not certified? This cannot be undone.`
      : `Discontinue ${candidate.name}? This cannot be undone.`
    if (!window.confirm(confirmMsg)) return
    start(async () => {
      const res = await ojtTransitionAction(
        candidate.agentId, to, note,
        to === 'active' ? joiningDate : null,
        to === 're_training' ? retrainStart : null
      )
      if (!res.ok) return setError(res.error)
      reset()
      router.refresh()
    })
  }

  if (mode === null) {
    return (
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button style={{ ...btn, borderColor: 'var(--status-green)', color: 'var(--status-green)' }} onClick={() => setMode('certify')}>Certify</button>
        {candidate.stage === 'ojt' && (
          <button style={{ ...btn, borderColor: 'var(--highlight)', color: 'var(--highlight)' }} onClick={() => setMode('re_training')}>Re-Train</button>
        )}
        <button style={{ ...btn, borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }} onClick={() => setMode('not_certified')}>Not Certify</button>
        <button style={{ ...btn, borderColor: 'var(--alert)', color: 'var(--alert)' }} onClick={() => setMode('discontinued')}>Discontinue</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '6px', minWidth: '220px' }}>
      {mode === 'certify' && (
        <>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Joining date</label>
          <input type="date" style={field} value={joiningDate} max={TODAY} onChange={(e) => setJoiningDate(e.target.value)} />
        </>
      )}
      {mode === 're_training' && (
        <>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Re-training starts</label>
          <input type="date" style={field} value={retrainStart} onChange={(e) => setRetrainStart(e.target.value)} />
        </>
      )}
      {(mode === 'not_certified' || mode === 'discontinued') && (
        <>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Reason (required)</label>
          <textarea style={{ ...field, minHeight: '50px' }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </>
      )}
      {mode === 'certify' && (
        <>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Note (optional)</label>
          <input style={field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </>
      )}
      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '12px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button disabled={pending} style={{ ...btn, color: '#fff', background: 'var(--brand)', borderColor: 'var(--brand)' }}
          onClick={() => submit(mode === 'certify' ? 'active' : mode)}>
          {pending ? 'Saving…' : 'Confirm'}
        </button>
        <button disabled={pending} style={btn} onClick={reset}>Cancel</button>
      </div>
    </div>
  )
}
