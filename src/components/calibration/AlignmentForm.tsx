'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordAlignmentAction } from '@/lib/calibration/actions'
import type { FatalAgreement, ParameterAgreement } from '@/lib/calibration/variance'

const seg = (active: boolean, tone: 'pass' | 'fail'): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
  borderWidth: '1px', borderStyle: 'solid',
  borderColor: active ? (tone === 'pass' ? 'var(--status-green)' : 'var(--alert)') : 'var(--border)',
  background: active ? (tone === 'pass' ? 'var(--status-green)' : 'var(--alert)') : 'transparent',
  color: active ? '#fff' : 'inherit',
})

/** Only the parameters/fatals the group actually split on — everything already agreed on carries
 * over automatically (schema_085), so this stays small no matter how big the rubric is. */
export function AlignmentForm({
  sessionId, splitParameters, splitFatals, initialParams, initialFatalIds, alignedAt, alignedByName,
}: {
  sessionId: string
  splitParameters: ParameterAgreement[]
  splitFatals: FatalAgreement[]
  initialParams: Record<string, boolean>
  initialFatalIds: string[]
  alignedAt: string | null
  alignedByName: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [params, setParams] = useState<Record<string, boolean | undefined>>(initialParams)
  const [fatals, setFatals] = useState<string[]>(initialFatalIds)
  const [error, setError] = useState<string | null>(null)

  if (splitParameters.length === 0 && splitFatals.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Everyone already agreed on every parameter and fatal error — nothing to align.</p>
  }

  const missing = splitParameters.filter((p) => params[p.parameterId] === undefined).length

  function submit() {
    setError(null)
    if (missing > 0) return setError(`Decide every disputed parameter first — ${missing} still to go.`)
    start(async () => {
      const res = await recordAlignmentAction(
        sessionId,
        splitParameters.map((p) => ({ parameter_id: p.parameterId, passed: params[p.parameterId] === true })),
        fatals
      )
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
        After talking it through, record what the group decided for each one below. Everything everyone already
        agreed on carries over automatically — this is only the disputed items.
      </p>
      {splitParameters.map((p) => (
        <div key={p.parameterId} style={{ padding: '8px 0', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '14px' }}>{p.name} <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({p.points} pts, {p.category})</span></div>
            <div role="group" aria-label={`${p.name} aligned pass or fail`} style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button type="button" style={seg(params[p.parameterId] === true, 'pass')} aria-pressed={params[p.parameterId] === true} onClick={() => setParams((m) => ({ ...m, [p.parameterId]: true }))}>Pass</button>
              <button type="button" style={seg(params[p.parameterId] === false, 'fail')} aria-pressed={params[p.parameterId] === false} onClick={() => setParams((m) => ({ ...m, [p.parameterId]: false }))}>Fail</button>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Pass: {p.passed.join(', ') || '—'}; Fail: {p.failed.join(', ') || '—'}</div>
        </div>
      ))}

      {splitFatals.length > 0 && (
        <div style={{ marginTop: '14px' }}>
          <h4 style={{ fontSize: '13px', margin: '0 0 6px' }}>Disputed fatal errors</h4>
          {splitFatals.map((f) => (
            <label key={f.fatalId} style={{ display: 'flex', gap: '8px', fontSize: '14px', padding: '4px 0' }}>
              <input type="checkbox" checked={fatals.includes(f.fatalId)}
                onChange={() => setFatals((x) => (x.includes(f.fatalId) ? x.filter((i) => i !== f.fatalId) : [...x, f.fatalId]))} />
              <span>
                {f.description} <span style={{ fontSize: '11px', color: f.severity === 'critical' ? 'var(--alert)' : 'var(--text-muted)' }}>
                  {f.severity === 'critical' ? 'Critical — zeroes the aligned score' : 'Major'}
                </span>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ticked by {f.ticked.join(', ') || '—'}; not by {f.notTicked.join(', ') || '—'}</div>
              </span>
            </label>
          ))}
        </div>
      )}

      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px', margin: '12px 0 0' }}>{error}</div>}
      <button type="button" onClick={submit} disabled={pending}
        style={{ marginTop: '14px', padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Saving…' : alignedAt ? 'Save alignment (replace)' : 'Save alignment'}
      </button>
      {alignedAt && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Already recorded by {alignedByName ?? 'someone'} — saving again replaces it.
        </p>
      )}
    </div>
  )
}
