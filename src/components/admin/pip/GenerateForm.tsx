'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateCandidatesAction } from '@/lib/pip/actions'
import { primaryBtn, disabledStyle } from '@/components/admin/users/styles'

/**
 * Suggests candidates for the cycle. The acknowledgement is required every time:
 * revenue only counts for an agent where a sale is MATCHED to them, so while many
 * sales are unmatched an agent can look far lower than they really are — and this
 * list leads to a real performance process.
 */
export function GenerateForm({ cycleId }: { cycleId: string }) {
  const router = useRouter()
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function go() {
    setError(null)
    setBusy(true)
    const res = await generateCandidatesAction(cycleId, ack)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setResult(`${res.inserted} candidate${res.inserted === 1 ? '' : 's'} suggested (${res.sharePct}% of this window's sales are matched to an agent).`)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label style={{ display: 'flex', gap: '8px', fontSize: '13px', alignItems: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: '3px' }} />
        <span>
          I understand revenue here is counted only where a sale is matched to an agent, so agents can appear lower than they really are.
          Every suggestion still needs a person to approve it.
        </span>
      </label>
      <div>
        <button onClick={go} disabled={busy || !ack} style={{ ...primaryBtn, ...(busy || !ack ? disabledStyle : {}) }}>
          {busy ? 'Suggesting…' : 'Suggest candidates'}
        </button>
      </div>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</div>}
      {result && <div style={{ fontSize: '13px', color: 'var(--status-green)' }}>{result}</div>}
    </div>
  )
}
