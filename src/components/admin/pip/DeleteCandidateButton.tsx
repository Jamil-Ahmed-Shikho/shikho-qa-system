'use client'
// Jamil, 2026-10-10: "give admin ... open PIP remove option — some test needs to remove." A real
// hard delete, available at ANY status (including an 'approved'/currently-running PIP) — distinct
// from Exclude, which keeps the row as part of the audit trail. For a mistaken or test entry that
// should never have existed at all.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCandidateAction } from '@/lib/pip/actions'
import type { PipStatus } from '@/lib/pip/pip.service'
import { dangerBtn, disabledStyle } from '@/components/admin/users/styles'

export function DeleteCandidateButton({ candidateId, cycleId, status, agentName }: { candidateId: string; cycleId: string; status: PipStatus; agentName: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    const extra = status === 'approved' ? ' This agent is currently ON a running PIP — deleting erases that entirely, not just excluding them.' : ''
    if (!window.confirm(`Permanently remove ${agentName} from this PIP list?${extra} This cannot be undone.`)) return
    start(async () => {
      const res = await deleteCandidateAction(candidateId, cycleId)
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div style={{ marginTop: '4px' }}>
      <button style={{ padding: '4px 10px', fontSize: '11px', ...dangerBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={remove}>
        {busy ? 'Removing…' : 'Remove…'}
      </button>
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '4px' }}>{error}</div>}
    </div>
  )
}
