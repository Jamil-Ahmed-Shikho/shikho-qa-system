'use client'
// Jamil, 2026-10-10: "give admin cycle ... remove option — some test needs to remove." A whole
// cycle can only be deleted while it is still unpublished (schema_081, admin_delete_pip_cycle) —
// once published its candidates can be real, running PIPs, so removing one of THOSE goes through
// DeleteCandidateButton below instead, one at a time, deliberately.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCycleAction } from '@/lib/pip/actions'
import { dangerBtn, disabledStyle } from '@/components/admin/users/styles'

export function DeleteCycleButton({ cycleId, candidateCount, monthLabel }: { cycleId: string; candidateCount: number; monthLabel: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    const warn = `Delete the ${monthLabel} PIP cycle? This removes ${candidateCount} candidate${candidateCount === 1 ? '' : 's'} with it. This cannot be undone.`
    if (!window.confirm(warn)) return
    start(async () => {
      const res = await deleteCycleAction(cycleId)
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div>
      <button style={{ ...dangerBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={remove}>
        {busy ? 'Deleting…' : 'Delete this cycle…'}
      </button>
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '6px' }}>{error}</div>}
    </div>
  )
}
