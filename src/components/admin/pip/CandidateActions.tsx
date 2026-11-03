'use client'
// The buttons for one candidate (§6.4, Section C, Stage 3). What is offered follows the workflow
// the database enforces:
//   suggested -> Exclude (reason required)     excluded -> Restore
//   approved  -> Mark completed | Mark failed
// Approval is now a LIST-LEVEL decision ("Publish this cycle", above this table) rather than a
// per-candidate one — a still-suggested row waits here for either an exclude or the cycle publishing.
// completed / failed are final. Only a Super Admin / QA Manager sees this component's page at all.
// The incentive downgrade is no longer a choice made here (Stage 4, schema_044, Q13) — it is set
// automatically the moment the candidate is APPROVED (publish), not on failure; the "Incentive
// downgraded" note on this page reflects that from the moment the cycle is published.
//
// "Flag for next PIP cycle" (schema_108, 2026-11-03) — a plain checkbox shown only when marking a
// candidate failed. It's a marker, not a forced action: generate_pip_candidates() already naturally
// reconsiders a failed agent next month if they're still below benchmark, so this doesn't change who
// gets suggested — it just records that QA specifically wants them reconsidered, shown as a remark
// on their next PIP candidate row (loadCycleWithCandidates()'s priorPipNote). `targetMet` lightly
// highlights the button matching the achievement figure already shown on this row (Mark completed
// when the target was met, Mark failed when it wasn't) — a suggestion, never a restriction; both
// buttons stay clickable either way, since the final call is always the admin's.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { decideAction } from '@/lib/pip/actions'
import type { PipStatus } from '@/lib/pip/pip.service'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { dangerBtn, ghostBtn, inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

type Mode = null | 'exclude' | 'fail' | 'complete'

export function CandidateActions({
  candidateId, cycleId, status, agentName, targetMet = null,
}: {
  candidateId: string
  cycleId: string
  status: PipStatus
  agentName: string
  /** Achieved-during-PIP vs target, from the row already shown — null when not yet known. */
  targetMet?: boolean | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [note, setNote] = useState('')
  const [flagNextPip, setFlagNextPip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(mode !== null && (note.trim() !== '' || flagNextPip))

  async function run(action: 'exclude' | 'restore' | 'complete' | 'fail', withNote: string | null = null) {
    setError(null)
    setBusy(true)
    const res = await decideAction(candidateId, cycleId, action, withNote, action === 'fail' ? flagNextPip : false)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setMode(null); setNote(''); setFlagNextPip(false)
    router.refresh()
  }

  if (status === 'completed' || status === 'failed') return <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Final</span>

  const disabled = busy ? disabledStyle : {}
  const suggestedBtn: React.CSSProperties = { outline: '2px solid var(--brand)', outlineOffset: '1px' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px' }}>
      {mode === null && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {status === 'suggested' && (
            <button style={{ ...ghostBtn, ...disabled }} disabled={busy} onClick={() => setMode('exclude')}>Exclude…</button>
          )}
          {status === 'excluded' && <button style={{ ...ghostBtn, ...disabled }} disabled={busy} onClick={() => run('restore')}>Restore to suggested</button>}
          {status === 'approved' && (
            <>
              <button style={{ ...ghostBtn, ...(targetMet === true ? suggestedBtn : {}), ...disabled }} disabled={busy} onClick={() => setMode('complete')}>Mark completed…</button>
              <button style={{ ...dangerBtn, ...(targetMet === false ? suggestedBtn : {}), ...disabled }} disabled={busy} onClick={() => setMode('fail')}>Mark failed…</button>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={flagNextPip} onChange={(e) => setFlagNextPip(e.target.checked)} />
              Flag for next PIP cycle (doesn&apos;t force it — just a note for next time)
            </label>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...disabled }} disabled={busy || (mode === 'exclude' && !note.trim())}
              onClick={() => run(mode, note.trim() || null)}>{busy ? 'Saving…' : 'Confirm'}</button>
            <button style={ghostBtn} disabled={busy} onClick={() => { setMode(null); setNote(''); setFlagNextPip(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
    </div>
  )
}
