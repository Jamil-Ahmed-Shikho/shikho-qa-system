'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { setTargetRuleAction, type RuleKind } from '@/lib/queue/actions'

const field: React.CSSProperties = {
  padding: '8px 10px', fontSize: '14px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid',
  borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit', width: '100%',
}
const label: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 500, margin: '0 0 4px', color: 'var(--text-muted)' }

export function TargetRuleForm({ kind, slabLabels, teams }: { kind: RuleKind; slabLabels: string[]; teams: readonly string[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [group, setGroup] = useState('')
  const [team, setTeam] = useState('')
  const [value, setValue] = useState('')
  const [from, setFrom] = useState<'current' | 'next'>('next')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useUnsavedGuard(group !== '' || value !== '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const n = Number(value)
    if (!group) return setMsg({ ok: false, text: 'Choose OJT or a vintage slab.' })
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return setMsg({ ok: false, text: 'Enter the target (zero or more).' })
    start(async () => {
      const res = await setTargetRuleAction({ kind, group, team: team || null, value: n, from })
      if (!res.ok) return setMsg({ ok: false, text: res.error })
      setMsg({ ok: true, text: `Saved — effective from the sales week starting ${res.effectiveFrom.slice(0, 10)}.` })
      setGroup(''); setValue('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', alignItems: 'end' }}>
        <div>
          <label style={label} htmlFor={`g-${kind}`}>Vintage</label>
          <select id={`g-${kind}`} style={field} value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Choose…</option>
            <option value="ojt">OJT</option>
            {slabLabels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`t-${kind}`}>Team</label>
          <select id={`t-${kind}`} style={field} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor={`v-${kind}`}>{kind === 'audit' ? 'Audits per week' : 'Revenue per week (USD)'}</label>
          <input id={`v-${kind}`} style={field} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label style={label} htmlFor={`f-${kind}`}>Starts</label>
          <select id={`f-${kind}`} style={field} value={from} onChange={(e) => setFrom(e.target.value as 'current' | 'next')}>
            <option value="next">Next sales week (Recommended)</option>
            <option value="current">This sales week</option>
          </select>
        </div>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
        A team-specific target beats an &quot;All teams&quot; one. Past weeks are never changed — &quot;This sales week&quot; only affects the week in progress.
      </p>
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: '13px', marginTop: '8px', color: msg.ok ? 'var(--status-green)' : 'var(--alert)' }}>{msg.text}</div>}
      <button type="submit" disabled={pending}
        style={{ marginTop: '12px', padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Saving…' : 'Save target'}
      </button>
    </form>
  )
}
