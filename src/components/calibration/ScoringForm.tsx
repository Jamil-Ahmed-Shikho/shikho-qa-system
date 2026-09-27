'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { submitScoreAction } from '@/lib/calibration/actions'
import type { CalibrationRubric } from '@/lib/calibration/calibration.service'

const NOTES_MAX = 2000

/** Same rule as submit_calibration_score(): Pass earns the points, a Critical fatal zeroes the score. */
function liveScore(rubric: CalibrationRubric, marks: Record<string, boolean | undefined>, fatals: string[]): number {
  const all = rubric.categories.flatMap((c) => c.parameters)
  const total = all.reduce((a, p) => a + p.points, 0)
  if (total <= 0) return 0
  if (rubric.fatals.some((f) => f.severity === 'critical' && fatals.includes(f.id))) return 0
  const earned = all.reduce((a, p) => a + (marks[p.id] === true ? p.points : 0), 0)
  return Math.round((earned / total) * 10000) / 100
}

const seg = (active: boolean, tone: 'pass' | 'fail'): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
  borderWidth: '1px', borderStyle: 'solid',
  borderColor: active ? (tone === 'pass' ? 'var(--status-green)' : 'var(--alert)') : 'var(--border)',
  background: active ? (tone === 'pass' ? 'var(--status-green)' : 'var(--alert)') : 'transparent',
  color: active ? '#fff' : 'inherit',
})

export function ScoringForm({ sessionId, rubric }: { sessionId: string; rubric: CalibrationRubric }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [marks, setMarks] = useState<Record<string, boolean | undefined>>({})
  const [fatals, setFatals] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const all = rubric.categories.flatMap((c) => c.parameters)
  const missing = all.filter((p) => marks[p.id] === undefined).length
  const dirty = !done && (Object.keys(marks).length > 0 || fatals.length > 0 || notes !== '')
  useUnsavedGuard(dirty)
  const score = liveScore(rubric, marks, fatals)

  function submit() {
    setError(null)
    if (missing > 0) return setError(`Score every parameter first — ${missing} still to go.`)
    if (!window.confirm('Submit your score? It is final — you cannot change it afterwards.')) return
    start(async () => {
      const res = await submitScoreAction(
        sessionId,
        all.map((p) => ({ parameter_id: p.id, passed: marks[p.id] === true })),
        fatals,
        notes
      )
      if (!res.ok) return setError(res.error)
      setDone(true)
      router.refresh()
    })
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
        Score the call on your own against <b>{rubric.name}</b>. A parameter earns its full points on Pass and nothing on Fail.
        Nobody else&apos;s score is shown until you have submitted yours and the session time has passed (or the session is closed).
      </p>
      {rubric.categories.map((c) => (
        <div key={c.id} style={{ marginBottom: '14px' }}>
          <h3 style={{ fontSize: '14px', margin: '0 0 6px' }}>{c.name}</h3>
          {c.parameters.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '6px 0', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
              <div style={{ fontSize: '14px' }}>{p.name} <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({p.points} pts)</span></div>
              <div role="group" aria-label={`${p.name} pass or fail`} style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button type="button" style={seg(marks[p.id] === true, 'pass')} aria-pressed={marks[p.id] === true} onClick={() => setMarks((m) => ({ ...m, [p.id]: true }))}>Pass</button>
                <button type="button" style={seg(marks[p.id] === false, 'fail')} aria-pressed={marks[p.id] === false} onClick={() => setMarks((m) => ({ ...m, [p.id]: false }))}>Fail</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      <h3 style={{ fontSize: '14px', margin: '8px 0 6px' }}>Fatal errors observed</h3>
      {rubric.fatals.length === 0 ? (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>None defined for this rubric.</div>
      ) : (
        rubric.fatals.map((f) => (
          <label key={f.id} style={{ display: 'flex', gap: '8px', fontSize: '14px', padding: '3px 0' }}>
            <input type="checkbox" checked={fatals.includes(f.id)}
              onChange={() => setFatals((x) => (x.includes(f.id) ? x.filter((i) => i !== f.id) : [...x, f.id]))} />
            <span>{f.description} <span style={{ fontSize: '11px', color: f.severity === 'critical' ? 'var(--alert)' : 'var(--text-muted)' }}>{f.severity === 'critical' ? 'Critical — zeroes the score' : 'Major'}</span></span>
          </label>
        ))
      )}

      <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, margin: '14px 0 4px' }} htmlFor="cal-notes">Notes (optional)</label>
      <textarea id="cal-notes" rows={3} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)}
        style={{ width: '100%', padding: '9px 12px', fontSize: '14px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit' }} />

      <div style={{ marginTop: '14px', fontSize: '14px' }}>Your score so far: <b>{score}%</b> {missing > 0 && <span style={{ color: 'var(--text-muted)' }}>({missing} parameter{missing === 1 ? '' : 's'} not scored)</span>}</div>
      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px', marginTop: '10px' }}>{error}</div>}
      <button type="button" onClick={submit} disabled={pending}
        style={{ marginTop: '14px', padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Submitting…' : 'Submit final score'}
      </button>
    </div>
  )
}
