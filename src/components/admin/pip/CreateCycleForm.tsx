'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createCycleAction } from '@/lib/pip/actions'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

/** Creates the PIP cycle for a month (starts the 2nd Saturday; length comes from the current policy). */
export function CreateCycleForm() {
  const router = useRouter()
  const [month, setMonth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useUnsavedGuard(month !== '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!month) return setError('Pick a month.')
    setBusy(true)
    const res = await createCycleAction(month)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.push(`/admin/pip/${res.id}`)
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div>
        <label style={labelStyle} htmlFor="pip-month">Month</label>
        <input id="pip-month" type="month" style={{ ...inputStyle, width: '200px' }} value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <button type="submit" disabled={busy || !month} style={{ ...primaryBtn, ...(busy || !month ? disabledStyle : {}) }}>{busy ? 'Creating…' : 'Create cycle'}</button>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)', flexBasis: '100%' }}>{error}</div>}
    </form>
  )
}
