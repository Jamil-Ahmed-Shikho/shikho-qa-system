'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closeSessionAction } from '@/lib/calibration/actions'

export function CloseButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Close this session? Scoring stops and every participant can see all scores and the variance report.')) return
          start(async () => {
            const res = await closeSessionAction(id)
            if (!res.ok) return setError(res.error)
            router.refresh()
          })
        }}
        style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--brand)', background: 'transparent', color: 'var(--brand)', fontSize: '13px', cursor: 'pointer' }}
      >
        {pending ? 'Closing…' : 'Close session & reveal scores'}
      </button>
      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
