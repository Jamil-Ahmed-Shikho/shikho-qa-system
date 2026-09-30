'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addTlCheckValueAction,
  setTlCheckTypeArchivedAction,
  setTlCheckValueArchivedAction,
} from '@/lib/team-lead-checks/definitions.actions'
import { inputStyle, ghostBtn, disabledStyle } from '@/components/admin/users/styles'
import type { TlCheckType } from '@/lib/team-lead-checks/definitions.service'

export function TlCheckTypeCard({ type }: { type: TlCheckType }) {
  const router = useRouter()
  const [newValue, setNewValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addValue(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const res = await addTlCheckValueAction(type.id, newValue)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setNewValue('')
    router.refresh()
  }

  async function toggleType() {
    setBusy(true)
    await setTlCheckTypeArchivedAction(type.id, !type.isArchived)
    setBusy(false)
    router.refresh()
  }

  async function toggleValue(id: string, archived: boolean) {
    setBusy(true)
    await setTlCheckValueArchivedAction(id, archived)
    setBusy(false)
    router.refresh()
  }

  const activeValues = type.values.filter((v) => !v.isArchived).length

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: '12px', opacity: type.isArchived ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div>
          <b style={{ fontSize: '14px' }}>{type.name}</b>
          {type.isArchived && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>(archived)</span>}
          {!type.isArchived && activeValues < 2 && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--highlight)' }}>needs 2+ active options to be usable</span>}
          {type.note && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{type.note}</div>}
        </div>
        <button onClick={toggleType} disabled={busy} style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }}>
          {type.isArchived ? 'Un-archive' : 'Archive'}
        </button>
      </div>

      <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {type.values.map((v) => (
          <span key={v.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: 'var(--radius-pill)',
            background: v.isArchived ? 'var(--surface-1)' : 'var(--brand-light)', fontSize: '12px', opacity: v.isArchived ? 0.6 : 1,
          }}>
            {v.label}{v.isArchived && ' (archived)'}
            <button onClick={() => toggleValue(v.id, !v.isArchived)} disabled={busy} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: '11px' }}>
              {v.isArchived ? 'restore' : 'archive'}
            </button>
          </span>
        ))}
      </div>

      {!type.isArchived && (
        <form onSubmit={addValue} style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
          <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Add an option" style={{ ...inputStyle, width: '220px' }} />
          <button type="submit" disabled={busy} style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }}>Add</button>
        </form>
      )}
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
