'use client'
// §6.4, Section C, Stage 3: Manager requests are input, never a direct edit — QA Manager / Super
// Admin accepts or rejects each one here. Accepting an Exclude request excludes the candidate
// (recording the MANAGER's own reason); accepting an Include request adds them as a new suggested
// candidate. Rejecting leaves everything exactly as it was. QA Manager/Super Admin can still act
// unilaterally at any time via the Exclude button on the main candidate table — a request is one
// input into the final decision, not the only route to one.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { decideRequestAction } from '@/lib/pip/actions'
import type { PipManagerRequest } from '@/lib/pip/pip.service'
import { ghostBtn, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

const TYPE_LABEL: Record<string, string> = { exclude: 'Exclude', include: 'Include' }
const STATUS_TONE: Record<string, string> = { pending: 'var(--highlight)', accepted: 'var(--status-green)', rejected: 'var(--text-muted)' }

function Row({ r, cycleId }: { r: PipManagerRequest; cycleId: string }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function decide(action: 'accept' | 'reject') {
    setError(null)
    start(async () => {
      const res = await decideRequestAction(r.id, cycleId, action, null)
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '10px 0', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '13px' }}>
          <b>{TYPE_LABEL[r.requestType]}</b> {r.agentName} — requested by {r.requestedByName ?? 'a Manager'}
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{r.reason}</div>
        </div>
        <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_TONE[r.status], whiteSpace: 'nowrap' }}>{r.status.toUpperCase()}</span>
      </div>
      {r.status === 'pending' ? (
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
          <button style={{ ...primaryBtn, padding: '5px 12px', fontSize: '12px', ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => decide('accept')}>Accept</button>
          <button style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => decide('reject')}>Reject</button>
        </div>
      ) : (
        r.decidedByName && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>By {r.decidedByName}{r.decisionNote ? ` — ${r.decisionNote}` : ''}</div>
      )}
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '4px' }}>{error}</div>}
    </div>
  )
}

export function ManagerRequestsSection({ cycleId, requests }: { cycleId: string; requests: PipManagerRequest[] }) {
  if (requests.length === 0) return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No Manager requests on this cycle yet.</p>
  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending')
  return (
    <div>
      {pending.length > 0 && <div style={{ fontSize: '12px', color: 'var(--highlight)', fontWeight: 600, marginBottom: '4px' }}>{pending.length} waiting for a decision</div>}
      {[...pending, ...decided].map((r) => <Row key={r.id} r={r} cycleId={cycleId} />)}
    </div>
  )
}
