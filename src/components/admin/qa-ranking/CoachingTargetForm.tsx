'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setCoachingTargetAction } from '@/lib/qa-ranking/actions'
import { inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function CoachingTargetForm({ current }: { current: number | null }) {
  const router = useRouter()
  const [value, setValue] = useState(String(current ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(value)
    setError(null)
    setBusy(true)
    const res = await setCoachingTargetAction(n)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Coaching sessions expected per auditor, per week:</label>
      <input type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle, width: '90px' }} />
      <button type="submit" disabled={busy} style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Save'}</button>
      {error && <span role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</span>}
    </form>
  )
}
