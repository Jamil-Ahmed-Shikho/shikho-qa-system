'use client'
// PIP policy (§6.4): revenue benchmark, vintage minimum, duration, target, bottom N per site,
// plus the two settings the design never specified (revenue window + unit) which the
// suggestion step REQUIRES before it will run. Saving supersedes the current policy — it never
// edits it in place, and existing cycles keep the policy they were created under.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setPolicyAction } from '@/lib/pip/actions'
import { validatePolicy, type PolicyInput } from '@/lib/pip/validation'
import type { PipPolicy } from '@/lib/pip/pip.service'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

type Draft = { benchmark: string; vintage: string; weeks: string; target: string; bottomN: string; window: string; unit: '' | 'BDT' | 'USD' }

const toDraft = (p: PipPolicy): Draft => ({
  benchmark: String(p.revenueBenchmark), vintage: String(p.vintageMinDays), weeks: String(p.durationWeeks), target: String(p.targetRevenue),
  bottomN: String(p.bottomNPerSite), window: p.revenueWindowWeeks === null ? '' : String(p.revenueWindowWeeks), unit: p.revenueUnit ?? '',
})

export function PolicyForm({ policy }: { policy: PipPolicy }) {
  const router = useRouter()
  const initial = toDraft(policy)
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  useUnsavedGuard(dirty)

  const set = (patch: Partial<Draft>) => { setD((x) => ({ ...x, ...patch })); setSaved(false) }
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const input: PolicyInput = {
      revenueBenchmark: num(d.benchmark), vintageMinDays: num(d.vintage), durationWeeks: num(d.weeks), targetRevenue: num(d.target),
      bottomNPerSite: num(d.bottomN), revenueWindowWeeks: d.window.trim() === '' ? null : num(d.window), revenueUnit: d.unit === '' ? null : d.unit,
    }
    const bad = validatePolicy(input)
    if (bad) return setError(bad)
    setBusy(true)
    const res = await setPolicyAction(input)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setSaved(true)
    router.refresh()
  }

  const field = (label: string, key: keyof Draft, hint?: string) => (
    <div>
      <label style={labelStyle} htmlFor={`pip-${key}`}>{label}</label>
      <input id={`pip-${key}`} style={inputStyle} inputMode="decimal" value={d[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} />
      {hint && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  )

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        {field('Revenue benchmark', 'benchmark', 'Only agents BELOW this can be suggested.')}
        {field('Minimum vintage (days)', 'vintage', 'Days since joining, on the cycle start date.')}
        {field('Duration (weeks)', 'weeks', 'Whole sales weeks (Sat–Fri), 1–12.')}
        {field('Target revenue', 'target')}
        {field('Bottom N per site', 'bottomN', 'Lowest-revenue agents suggested per site.')}
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>How “lowest revenue” is measured — must be set before suggestions can run</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Not guessed: it decides who looks lowest. The window is the number of completed sales weeks before the cycle starts.
          USD converts each sale at the rate in force on the day of that sale.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
          {field('Revenue window (weeks)', 'window')}
          <div>
            <label style={labelStyle} htmlFor="pip-unit">Unit</label>
            <select id="pip-unit" style={inputStyle} value={d.unit} onChange={(e) => set({ unit: e.target.value as Draft['unit'] })}>
              <option value="">— not set —</option>
              <option value="BDT">BDT (taka)</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div role="alert" style={{ padding: '10px 14px', fontSize: '13px', background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', color: 'var(--alert)' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button type="submit" disabled={busy || !dirty} style={{ ...primaryBtn, ...(busy || !dirty ? disabledStyle : {}) }}>{busy ? 'Saving…' : 'Save as the new policy'}</button>
        {saved && !dirty && <span style={{ fontSize: '12px', color: 'var(--status-green)' }}>Saved — existing cycles keep the policy they were created under.</span>}
      </div>
    </form>
  )
}
