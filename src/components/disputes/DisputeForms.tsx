'use client'
// The two dispute forms.
//  - FileDisputeForm: the agent (own audit) or their Team Lead (on the agent's behalf).
//  - DisputeAdminControls: Super Admin / QA Manager take a dispute into review and resolve it.
// The database enforces every rule; messages shown are its own plain-language ones.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { fileDisputeAction, resolveDisputeAction, startReviewAction } from '@/lib/disputes/actions'
import { DISPUTE_TEXT_MAX, OUTCOMES, OUTCOME_LABEL, validateDisputeReason, validateResolution, type Outcome } from '@/lib/disputes/validation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { VoiceInputButton } from '@/components/common/VoiceInputButton'
import { ghostBtn, inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        aria-label={label} style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', lineHeight: 1.5, paddingRight: '92px' }}
        value={value} maxLength={DISPUTE_TEXT_MAX} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      />
      <VoiceInputButton onTranscript={(t: string) => onChange((value ? `${value} ${t}` : t).slice(0, DISPUTE_TEXT_MAX))} />
    </div>
  )
}

export function FileDisputeForm({ auditId, onBehalfOf }: { auditId: string; onBehalfOf: string | null }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(reason.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const bad = validateDisputeReason(reason)
    if (bad) return setError(bad)
    const who = onBehalfOf ? `This will be recorded as filed by you, as Team Leader, on behalf of ${onBehalfOf}.` : 'This will formally dispute the audit.'
    if (!confirm(`${who} A dispute can only be filed once for an audit. Continue?`)) return
    setBusy(true)
    const res = await fileDisputeAction(auditId, reason)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setReason('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={labelStyle} htmlFor="dispute-reason">{onBehalfOf ? `What is being disputed on behalf of ${onBehalfOf}?` : 'What are you disputing, and why?'}</label>
      <Area label="Reason for the dispute" value={reason} onChange={setReason}
        placeholder="Be specific: which part of the audit, and what the recording or the facts show." />
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !reason.trim()} style={{ ...primaryBtn, ...(busy || !reason.trim() ? disabledStyle : {}) }}>{busy ? 'Filing…' : onBehalfOf ? 'File dispute on their behalf' : 'File dispute'}</button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{reason.length}/{DISPUTE_TEXT_MAX}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}

export function DisputeAdminControls({ disputeId, auditId, status, youConducted }: { disputeId: string; auditId: string; status: 'open' | 'under_review'; youConducted: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | ''>('')
  const [note, setNote] = useState('')
  useUnsavedGuard(resolving && note.trim() !== '')

  async function review() {
    setError(null); setBusy(true)
    const res = await startReviewAction(disputeId, auditId)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  async function resolve(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const bad = validateResolution(outcome || null, note)
    if (bad) return setError(bad)
    if (!confirm('Resolve this dispute? The decision is final. It records the outcome and your note; it does not change the audit\'s score.')) return
    setBusy(true)
    const res = await resolveDisputeAction(disputeId, auditId, outcome, note)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {youConducted && (
        <div style={{ fontSize: '12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)' }}>
          You conducted this audit. You can still decide it, but consider asking another QA Manager to.
        </div>
      )}
      {!resolving ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {status === 'open' && <button style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={review}>{busy ? 'Starting…' : 'Start review'}</button>}
          <button style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => setResolving(true)}>Resolve…</button>
        </div>
      ) : (
        <form onSubmit={resolve} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, padding: 0 }}>Outcome</legend>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              {OUTCOMES.map((o) => (
                <label key={o} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '14px', cursor: 'pointer' }}>
                  <input type="radio" name={`outcome-${disputeId}`} checked={outcome === o} onChange={() => setOutcome(o)} /> {OUTCOME_LABEL[o]}
                </label>
              ))}
            </div>
          </fieldset>
          <Area label="Resolution note" value={note} onChange={setNote} placeholder="Explain the decision — what you checked and why." />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy || !outcome || !note.trim()} style={{ ...primaryBtn, ...(busy || !outcome || !note.trim() ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Resolve dispute'}</button>
            <button type="button" style={ghostBtn} disabled={busy} onClick={() => { setResolving(false); setError(null) }}>Cancel</button>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{note.length}/{DISPUTE_TEXT_MAX}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Resolving records the decision. It does not change the audit&apos;s score — any correction is a separate step.</div>
        </form>
      )}
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </div>
  )
}
