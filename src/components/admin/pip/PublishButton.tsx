'use client'
// §6.4, Stage 3: the list-level decision that replaces per-candidate approval. Every candidate
// still 'suggested' at this point becomes 'approved'; anything already excluded stays excluded.
// Any request nobody decided is closed as rejected rather than left pending forever.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { publishCycleAction } from '@/lib/pip/actions'
import { primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function PublishButton({ cycleId, pendingCount, suggestedCount }: { cycleId: string; pendingCount: number; suggestedCount: number }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function publish() {
    setError(null)
    const warn = pendingCount > 0
      ? `${pendingCount} Manager request${pendingCount === 1 ? ' is' : 's are'} still waiting for a decision — publishing will close ${pendingCount === 1 ? 'it' : 'them'} as rejected. Publish anyway?`
      : `Publish this cycle? ${suggestedCount} agent${suggestedCount === 1 ? '' : 's'} will be approved for PIP. This cannot be undone.`
    if (!window.confirm(warn)) return
    start(async () => {
      const res = await publishCycleAction(cycleId)
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div>
      <button style={{ ...primaryBtn, ...(busy || suggestedCount === 0 ? disabledStyle : {}) }} disabled={busy || suggestedCount === 0} onClick={publish}>
        {busy ? 'Publishing…' : `Publish this cycle (${suggestedCount} to approve)`}
      </button>
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
