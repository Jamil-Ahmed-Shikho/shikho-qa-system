'use client'
// The Review Request forms/controls (§4, Section D, Part 1). REPLACES DisputeForms.tsx entirely.
//  - FileReviewRequestForm: the agent (own audit), or their Team Lead/Manager on the agent's behalf.
//  - TeamLeadDecideControls: the Team Lead's own uphold/escalate decision (uphold is FINAL, never a score change).
//  - AssignControls: QA Manager/Super Admin assigns the re-audit to themself or a QA Auditor.
//  - StartReauditButton: starts the re-audit and takes the caller straight to it.
//  - DecideRevisionControls: QA Manager/Super Admin approves or rejects the submitted re-audit.
// The database enforces every rule; messages shown are its own plain-language ones.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assignReviewRequestAction, decideRevisionAction, fileReviewRequestAction, startReauditAction, teamLeadDecideAction } from '@/lib/review-requests/actions'
import { NOTE_MAX, REASON_MAX, validateNote, validateReason } from '@/lib/review-requests/validation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { VoiceInputButton } from '@/components/common/VoiceInputButton'
import { ghostBtn, inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

function Area({ label, value, onChange, placeholder, max }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; max: number }) {
  return (
    <div style={{ position: 'relative' }}>
      <textarea
        aria-label={label} style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', lineHeight: 1.5, paddingRight: '92px' }}
        value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      />
      <VoiceInputButton onTranscript={(t: string) => onChange((value ? `${value} ${t}` : t).slice(0, max))} />
    </div>
  )
}

export function FileReviewRequestForm({ auditId, onBehalfOf }: { auditId: string; onBehalfOf: string | null }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(reason.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const bad = validateReason(reason)
    if (bad) return setError(bad)
    const who = onBehalfOf ? `This will be recorded as filed by you on behalf of ${onBehalfOf}.` : 'This will formally request a review of the audit.'
    if (!confirm(`${who} A Review Request can only be filed once for an audit, and only within 7 days of it being submitted. Continue?`)) return
    setBusy(true)
    const res = await fileReviewRequestAction(auditId, reason)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setReason('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={labelStyle} htmlFor="review-request-reason">{onBehalfOf ? `What is being requested a review of, on behalf of ${onBehalfOf}?` : 'What are you requesting a review of, and why?'}</label>
      <Area label="Reason for the Review Request" value={reason} onChange={setReason} max={REASON_MAX}
        placeholder="Be specific: which part of the audit, and what the recording or the facts show." />
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !reason.trim()} style={{ ...primaryBtn, ...(busy || !reason.trim() ? disabledStyle : {}) }}>
          {busy ? 'Filing…' : onBehalfOf ? 'File Review Request on their behalf' : 'File Review Request'}
        </button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{reason.length}/{REASON_MAX}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}

export function TeamLeadDecideControls({ id, auditId }: { id: string; auditId: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'uphold' | 'escalate'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(mode !== null && note.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!mode) return
    setError(null)
    const bad = validateNote(note)
    if (bad) return setError(bad)
    if (mode === 'uphold' && !confirm('Uphold the original audit? This is FINAL — no score change is possible from here, and this cannot be undone.')) return
    setBusy(true)
    const res = await teamLeadDecideAction(id, auditId, mode, note)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setMode(null); setNote('')
    router.refresh()
  }

  if (!mode) {
    return (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button style={ghostBtn} onClick={() => setMode('uphold')}>Uphold (final)…</button>
        <button style={primaryBtn} onClick={() => setMode('escalate')}>Escalate to QA Manager…</button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={labelStyle}>{mode === 'uphold' ? 'Note explaining why the original stands' : 'Note for QA Manager'}</label>
      <Area label="Note" value={note} onChange={setNote} max={NOTE_MAX} placeholder="Explain your reasoning." />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !note.trim()} style={{ ...primaryBtn, ...(busy || !note.trim() ? disabledStyle : {}) }}>
          {busy ? 'Saving…' : mode === 'uphold' ? 'Confirm uphold' : 'Confirm escalate'}
        </button>
        <button type="button" style={ghostBtn} disabled={busy} onClick={() => { setMode(null); setError(null) }}>Cancel</button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{note.length}/{NOTE_MAX}</span>
      </div>
      {mode === 'uphold' && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Upholding is final — you can never revise the score yourself; any revision always goes through QA Manager.</div>}
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}

export function AssignControls({ id, auditId, qaStaff }: { id: string; auditId: string; qaStaff: { id: string; name: string; role: string }[] }) {
  const router = useRouter()
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!assignee) return setError('Choose who this should go to.')
    setError(null); setBusy(true)
    const res = await assignReviewRequestAction(id, auditId, assignee)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label style={labelStyle}>Assign the re-audit to</label>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: '220px' }}>
          <option value="">Choose…</option>
          {qaStaff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={submit}>{busy ? 'Assigning…' : 'Assign'}</button>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </div>
  )
}

export function StartReauditButton({ id, auditId }: { id: string; auditId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (!confirm('Start the re-audit now? A fresh scorecard will open against the same call, scored using the full normal audit workflow.')) return
    setError(null); setBusy(true)
    const res = await startReauditAction(id, auditId)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.push(`/audits/${res.reauditId}`)
  }

  return (
    <div>
      <button style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start re-audit'}</button>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)', marginTop: '8px' }}>{error}</div>}
    </div>
  )
}

export function DecideRevisionControls({ id, auditId }: { id: string; auditId: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(mode !== null && note.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!mode) return
    setError(null)
    const bad = validateNote(note)
    if (bad) return setError(bad)
    const q = mode === 'approve'
      ? 'Approve this revision? The re-audit\'s score and feedback become the effective ones for this audit — the original record is kept, unedited, for history. This is FINAL.'
      : 'Reject this revision? The original audit stands, unchanged. This is FINAL.'
    if (!confirm(q)) return
    setBusy(true)
    const res = await decideRevisionAction(id, auditId, mode, note)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setMode(null); setNote('')
    router.refresh()
  }

  if (!mode) {
    return (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button style={ghostBtn} onClick={() => setMode('reject')}>Reject…</button>
        <button style={primaryBtn} onClick={() => setMode('approve')}>Approve…</button>
      </div>
    )
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={labelStyle}>Note</label>
      <Area label="Note" value={note} onChange={setNote} max={NOTE_MAX} placeholder="Explain the decision — what you checked and why." />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !note.trim()} style={{ ...primaryBtn, ...(busy || !note.trim() ? disabledStyle : {}) }}>
          {busy ? 'Saving…' : mode === 'approve' ? 'Confirm approve' : 'Confirm reject'}
        </button>
        <button type="button" style={ghostBtn} disabled={busy} onClick={() => { setMode(null); setError(null) }}>Cancel</button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{note.length}/{NOTE_MAX}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}
