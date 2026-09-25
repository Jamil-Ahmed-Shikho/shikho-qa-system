'use client'
// A Team Lead's note about their own agent's PIP. Append-only: once saved it can't be edited or removed
// (the database has no update / delete for it), so the form says so before saving.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addFeedbackAction } from '@/lib/pip/actions'
import { FEEDBACK_MAX } from '@/lib/pip/validation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { VoiceInputButton } from '@/components/common/VoiceInputButton'
import { inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function FeedbackForm({ candidateId }: { candidateId: string }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(text.trim() !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!confirm('Save this feedback? It becomes part of the PIP record and cannot be edited or deleted afterwards.')) return
    setBusy(true)
    const res = await addFeedbackAction(candidateId, text)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setText('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ position: 'relative' }}>
        <textarea
          aria-label="Feedback on this agent's progress" style={{ ...inputStyle, minHeight: '96px', resize: 'vertical', lineHeight: 1.5, paddingRight: '92px' }}
          value={text} maxLength={FEEDBACK_MAX} onChange={(e) => setText(e.target.value)}
          placeholder="How is the agent doing? What have you coached, and what has changed?"
        />
        <VoiceInputButton onTranscript={(t: string) => setText((prev) => (prev ? `${prev} ${t}` : t).slice(0, FEEDBACK_MAX))} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !text.trim()} style={{ ...primaryBtn, ...(busy || !text.trim() ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Save feedback'}</button>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{text.length}/{FEEDBACK_MAX}</span>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
    </form>
  )
}
