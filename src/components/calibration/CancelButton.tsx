'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelSessionAction } from '@/lib/calibration/actions'

export function CancelButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Cancel this calibration session? Participants will no longer see it as upcoming.')) return
          start(async () => {
            const res = await cancelSessionAction(id)
            if (!res.ok) return setError(res.error)
            router.refresh()
          })
        }}
        style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--alert)', background: 'transparent', color: 'var(--alert)', fontSize: '13px', cursor: 'pointer' }}
      >
        {pending ? 'Cancelling…' : 'Cancel session'}
      </button>
      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
