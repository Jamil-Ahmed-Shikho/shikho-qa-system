'use client'
// PIP policy (§6.4): revenue benchmark, vintage minimum (completed sales weeks, Q8), duration,
// target, bottom N per team/channel, and which teams/channels PIP applies to (Q15). The revenue
// window and currency are FIXED facts (schema_041/042), not settings — stated in the explanatory
// text below, never editable. Saving supersedes the current policy — it never edits it in place,
// and existing cycles keep the policy they were created under.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setPolicyAction } from '@/lib/pip/actions'
import { validatePolicy, type PolicyInput } from '@/lib/pip/validation'
import type { PipPolicy } from '@/lib/pip/pip.service'
import { TEAM_NAMES } from '@/types/database.types'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

type Draft = { benchmark: string; vintage: string; weeks: string; target: string; bottomN: string; teams: string[] }

const toDraft = (p: PipPolicy): Draft => ({
  benchmark: String(p.revenueBenchmark), vintage: String(p.vintageMinWeeks), weeks: String(p.durationWeeks), target: String(p.targetRevenue),
  bottomN: String(p.bottomNPerSite), teams: p.scopedTeams,
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
  const toggleTeam = (t: string) => set({ teams: d.teams.includes(t) ? d.teams.filter((x) => x !== t) : [...d.teams, t] })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const input: PolicyInput = {
      revenueBenchmark: num(d.benchmark), vintageMinWeeks: num(d.vintage), durationWeeks: num(d.weeks), targetRevenue: num(d.target),
      bottomNPerSite: num(d.bottomN), scopedTeams: d.teams,
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
      <input id={`pip-${key}`} style={inputStyle} inputMode="decimal" value={d[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} />
      {hint && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  )

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        {field('Revenue benchmark (USD)', 'benchmark', 'Only agents BELOW this can be suggested.')}
        {field('Minimum vintage (completed sales weeks)', 'vintage', 'Sat–Fri weeks fully worked before the cycle starts — not calendar days.')}
        {field('Duration (weeks)', 'weeks', 'Whole sales weeks (Sat–Fri), 1–12.')}
        {field('Target revenue (USD)', 'target', 'The pass target for the PIP period.')}
        {field('Bottom N per team/channel', 'bottomN', 'Lowest-revenue agents suggested per team/channel (never grouped by site alone).')}
      </div>

      <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>How “lowest revenue” is measured — fixed facts, not settings</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          Always <b>USD</b> — each sale converts at the rate in force on the day of that sale (never today's rate applied
          retroactively). The window is always the full calendar month before the cycle's own month (an October cycle
          looks at all of September; a November cycle, all of October).
        </div>
      </div>

      <div>
        <label style={labelStyle}>Scope — which teams/channels PIP applies to</label>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
          At least one. Today this is Telesales (both Dhaka and Jashore); CX, Retention and TS3P can be added here later with no rebuild.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {TEAM_NAMES.map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              <input type="checkbox" checked={d.teams.includes(t)} onChange={() => toggleTeam(t)} />
              {t}
            </label>
          ))}
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
