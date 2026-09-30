'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addTlCheckTypeAction } from '@/lib/team-lead-checks/definitions.actions'
import { inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function TlCheckTypeForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await addTlCheckTypeAction(name, note || null)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setName('')
    setNote('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '16px' }}>
      <div style={{ flex: '1 1 200px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>New check name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales pipeline followed up" style={inputStyle} />
      </div>
      <div style={{ flex: '1 1 200px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Note to Team Lead (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional guidance" style={inputStyle} />
      </div>
      <button type="submit" disabled={busy} style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }}>{busy ? 'Adding…' : 'Add check'}</button>
      {error && <span role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</span>}
    </form>
  )
}
