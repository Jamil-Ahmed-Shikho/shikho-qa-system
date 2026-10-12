'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setImpactWeightsAction, type ImpactWeightsInput } from '@/lib/qa-ranking/actions'
import { inputStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'
import type { ImpactWeights } from '@/lib/qa-ranking/qa-ranking.service'

const FIELDS: { key: keyof ImpactWeightsInput; label: string }[] = [
  { key: 'audit', label: 'Audit %' },
  { key: 'coaching', label: 'Coaching %' },
  { key: 'salesGrowth', label: 'Sales Growth' },
  { key: 'vintageTarget', label: 'Vintage Target Met %' },
  { key: 'agentRecovery', label: 'Agent Recovery %' },
  { key: 'zeroSeller', label: 'Zero-Seller Recovery %' },
]

export function ImpactWeightsForm({ current }: { current: ImpactWeights | null }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<keyof ImpactWeightsInput, string>>({
    audit: String(current?.audit ?? ''),
    coaching: String(current?.coaching ?? ''),
    salesGrowth: String(current?.salesGrowth ?? ''),
    vintageTarget: String(current?.vintageTarget ?? ''),
    agentRecovery: String(current?.agentRecovery ?? ''),
    zeroSeller: String(current?.zeroSeller ?? ''),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sum = FIELDS.reduce((acc, f) => acc + (Number(values[f.key]) || 0), 0)
  const sumOk = Math.abs(sum - 100) < 0.01

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!sumOk) { setError(`The six weights must add up to 100 — they currently add up to ${sum}.`); return }
    const weights: ImpactWeightsInput = {
      audit: Number(values.audit), coaching: Number(values.coaching), salesGrowth: Number(values.salesGrowth),
      vintageTarget: Number(values.vintageTarget), agentRecovery: Number(values.agentRecovery), zeroSeller: Number(values.zeroSeller),
    }
    setBusy(true)
    const res = await setImpactWeightsAction(weights)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
        How much each metric counts toward the Total Score (must add up to 100):
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {f.label}
            <input
              type="number" min={0} max={100} step={1}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              style={{ ...inputStyle, width: '72px' }}
            />
          </label>
        ))}
        <button type="submit" disabled={busy} style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Save weights'}</button>
      </div>
      <div style={{ fontSize: '12px', color: sumOk ? 'var(--text-muted)' : 'var(--alert)' }}>
        Current total: {sum}{!sumOk ? ' — must equal 100' : ''}
      </div>
      {error && <span role="alert" style={{ fontSize: '13px', color: 'var(--alert)' }}>{error}</span>}
    </form>
  )
}
