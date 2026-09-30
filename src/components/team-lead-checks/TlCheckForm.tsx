'use client'

import { useState } from 'react'
import { submitTeamLeadCheckAction } from '@/lib/team-lead-checks/actions'
import { inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'
import { BackLink } from '@/components/common/BackLink'
import type { TlCheckType } from '@/lib/team-lead-checks/definitions.service'

export function TlCheckForm({
  agentId, leadId, callId, checkTypes, backHref,
}: {
  agentId: string
  leadId: string
  callId: string
  checkTypes: TlCheckType[]
  backHref: string
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const payload = Object.entries(answers)
      .filter(([, v]) => v)
      .map(([checkTypeId, valueId]) => ({ checkTypeId, valueId }))
    const res = await submitTeamLeadCheckAction(agentId, leadId, callId, payload, notes.trim() || null)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setDone(true)
  }

  if (done) {
    return (
      <div style={{ padding: '20px', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <p style={{ fontSize: '14px', margin: '0 0 12px' }}>Check logged.</p>
        <BackLink href={backHref} label="Back to this agent's calls" />
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      {checkTypes.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No checks are set up yet — you can still add a note below.</p>
      ) : (
        checkTypes.map((t) => (
          <div key={t.id} style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>{t.name}</label>
            {t.note && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 6px' }}>{t.note}</p>}
            <select
              value={answers[t.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [t.id]: e.target.value }))}
              style={inputStyle}
            >
              <option value="">Not answered</option>
              {t.values.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        ))
      )}

      <div style={{ marginBottom: '16px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      <button type="submit" disabled={busy} style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }}>
        {busy ? 'Saving…' : 'Log this check'}
      </button>
      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px', marginTop: '8px' }}>{error}</div>}
    </form>
  )
}
