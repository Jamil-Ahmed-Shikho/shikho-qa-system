'use client'
// PIP training sessions (§6.4): 1 = the pre-PIP session, then 2, 3 ... QA staff only.
// An auditor can only schedule / update sessions they conduct; that is enforced by the database.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addTrainingAction, updateTrainingAction } from '@/lib/pip/actions'
import { TRAINING_NOTES_MAX } from '@/lib/pip/validation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { ghostBtn, inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function AddTrainingForm({ candidateId, nextNumber }: { candidateId: string; nextNumber: number }) {
  const router = useRouter()
  const [n, setN] = useState(String(nextNumber))
  const [when, setWhen] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(when !== '' || notes.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await addTrainingAction(candidateId, Number(n), when ? new Date(when).toISOString() : '', notes)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setWhen(''); setNotes(''); setN(String(Number(n) + 1))
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div><label style={labelStyle} htmlFor="tr-n">Session #</label><input id="tr-n" style={{ ...inputStyle, width: '90px' }} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></div>
        <div><label style={labelStyle} htmlFor="tr-when">Date &amp; time</label><input id="tr-when" type="datetime-local" style={{ ...inputStyle, width: '230px' }} value={when} onChange={(e) => setWhen(e.target.value)} /></div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="tr-notes">Notes (optional)</label>
        <textarea id="tr-notes" style={{ ...inputStyle, minHeight: '56px', resize: 'vertical' }} maxLength={TRAINING_NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <button type="submit" disabled={busy || !when} style={{ ...primaryBtn, ...(busy || !when ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Add session'}</button>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}

export function TrainingRowActions({ trainingId, candidateId, status }: { trainingId: string; candidateId: string; status: 'scheduled' | 'completed' | 'cancelled' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: 'completed' | 'cancelled', attended: boolean | null) {
    setError(null)
    setBusy(true)
    const res = await updateTrainingAction(trainingId, candidateId, { status: next, attended })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  if (status !== 'scheduled') return null
  const off = busy ? disabledStyle : {}
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
      <button style={{ ...ghostBtn, ...off }} disabled={busy} onClick={() => set('completed', true)}>Attended</button>
      <button style={{ ...ghostBtn, ...off }} disabled={busy} onClick={() => set('completed', false)}>Did not attend</button>
      <button style={{ ...ghostBtn, ...off }} disabled={busy} onClick={() => { if (confirm('Cancel this session?')) set('cancelled', null) }}>Cancel</button>
      {error && <span role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</span>}
    </div>
  )
}
