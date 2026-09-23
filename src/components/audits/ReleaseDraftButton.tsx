'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { releaseDraft } from '@/lib/audits/actions'

export function ReleaseDraftButton({ auditId, leadId }: { auditId: string; leadId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!confirm('Release this draft? It will be removed and the call becomes available again.')) return
    startTransition(async () => {
      await releaseDraft(auditId, leadId)
      router.push(leadId ? `/audits/leads/${leadId}` : '/audits')
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      style={{
        padding: '10px 18px', fontSize: '13px', fontWeight: 500, color: 'var(--alert)',
        background: 'var(--alert-light)', border: 'none', borderRadius: 'var(--radius-sm)',
        cursor: pending ? 'not-allowed' : 'pointer',
      }}
    >
      {pending ? 'Releasing...' : 'Release Draft'}
    </button>
  )
}
