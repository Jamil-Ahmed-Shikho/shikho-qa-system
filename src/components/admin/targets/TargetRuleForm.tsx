'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { setTargetRuleAction, type RuleKind } from '@/lib/queue/actions'
import type { TargetRuleRow } from '@/lib/queue/queue.service'
import { formatUsd } from '@/lib/money/usd'

const field: React.CSSProperties = {
  padding: '8px 10px', fontSize: '14px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid',
  borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit', width: '100%',
}
const label: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 500, margin: '0 0 4px', color: 'var(--text-muted)' }
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', fontSize: '13px',
  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', userSelect: 'none',
}
const chipOn: React.CSSProperties = { background: 'var(--brand-light)', borderColor: 'var(--brand)', color: 'var(--brand)', fontWeight: 600 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 500 }
const td: React.CSSProperties = { padding: '8px', fontSize: '14px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)' }

type Staged = {
  key: string // group|team — identifies the (vintage, team) target, so re-adding the same combo edits it in place
  group: string
  groupLabel: string
  team: string | null
  value: string
  from: 'current' | 'next'
}

const ymd = (d: string) => d.slice(0, 10)

export function TargetRuleForm({
  kind, slabLabels, teams, rows, thisWeek,
}: {
  kind: RuleKind
  slabLabels: string[]
  teams: readonly string[]
  rows: TargetRuleRow[]
  thisWeek: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [groups, setGroups] = useState<string[]>([])
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [allTeams, setAllTeams] = useState(false)
  const [value, setValue] = useState('')
  const [from, setFrom] = useState<'current' | 'next'>('next')
  const [staged, setStaged] = useState<Staged[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useUnsavedGuard(staged.length > 0)

  const groupOptions = [{ value: 'ojt', label: 'OJT' }, ...slabLabels.map((l) => ({ value: l, label: l }))]
  const groupLabel = (g: string) => (g === 'ojt' ? 'OJT' : g)

  function toggle(list: string[], setList: (v: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  function upsertStaged(entries: Staged[]) {
    setStaged((prev) => {
      const next = [...prev]
      for (const entry of entries) {
        const idx = next.findIndex((s) => s.key === entry.key)
        if (idx >= 0) next[idx] = entry
        else next.push(entry)
      }
      return next
    })
  }

  function addToStaged(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const n = Number(value)
    if (groups.length === 0) return setMsg({ ok: false, text: 'Choose at least one vintage (or OJT).' })
    if (!allTeams && selectedTeams.length === 0) return setMsg({ ok: false, text: 'Choose at least one team, or check "All teams".' })
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return setMsg({ ok: false, text: 'Enter the target (zero or more).' })

    const teamList: (string | null)[] = allTeams ? [null] : selectedTeams
    const entries: Staged[] = []
    for (const g of groups) {
      for (const t of teamList) {
        entries.push({ key: `${g}|${t ?? ''}`, group: g, groupLabel: groupLabel(g), team: t, value: String(n), from })
      }
    }
    upsertStaged(entries)
    setGroups([]); setSelectedTeams([]); setAllTeams(false); setValue('')
  }

  /** "Edit" on an existing row: stage it pre-filled so a changed number alone corrects it in place. */
  function editRow(r: TargetRuleRow, state: 'Current' | 'Scheduled') {
    const group = r.isOjt ? 'ojt' : (r.vintageLabel ?? '')
    const rowFrom: 'current' | 'next' = state === 'Scheduled' ? 'next' : 'current'
    upsertStaged([{
      key: `${group}|${r.teamName ?? ''}`,
      group, groupLabel: groupLabel(group), team: r.teamName, value: String(r.value), from: rowFrom,
    }])
    setMsg(null)
  }

  function updateStagedValue(key: string, v: string) {
    setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, value: v } : s)))
  }
  function removeStaged(key: string) {
    setStaged((prev) => prev.filter((s) => s.key !== key))
  }

  function saveAll() {
    setMsg(null)
    const bad = staged.find((s) => s.value.trim() === '' || !Number.isFinite(Number(s.value)) || Number(s.value) < 0)
    if (bad) return setMsg({ ok: false, text: `"${bad.groupLabel} / ${bad.team ?? 'All teams'}" needs a valid target before saving.` })

    start(async () => {
      const results = await Promise.all(
        staged.map(async (s) => ({
          s,
          res: await setTargetRuleAction({ kind, group: s.group, team: s.team, value: Number(s.value), from: s.from }),
        }))
      )
      const failed = results.filter((r) => !r.res.ok)
      const succeededKeys = new Set(results.filter((r) => r.res.ok).map((r) => r.s.key))
      setStaged((prev) => prev.filter((s) => !succeededKeys.has(s.key)))
      if (failed.length === 0) {
        setMsg({ ok: true, text: `Saved ${results.length} target${results.length === 1 ? '' : 's'}.` })
      } else {
        const first = failed[0].res as { ok: false; error: string }
        setMsg({ ok: false, text: `${results.length - failed.length} saved, ${failed.length} failed (e.g. "${failed[0].s.groupLabel} / ${failed[0].s.team ?? 'All teams'}": ${first.error}) — fix and try again.` })
      }
      router.refresh()
    })
  }

  // Per key, the newest rule already in force is "current"; later ones are "scheduled"; older ones are "history".
  const keyOf = (r: TargetRuleRow) => `${r.isOjt ? 'ojt' : r.vintageLabel}|${r.teamName ?? ''}`
  const currentIds = new Set<string>()
  const seen = new Set<string>()
  for (const r of rows) { // rows arrive newest first
    const k = keyOf(r)
    if (!seen.has(k) && ymd(r.effectiveFrom) <= thisWeek) { currentIds.add(r.id); seen.add(k) }
  }
  const stateOf = (r: TargetRuleRow): 'Scheduled' | 'Current' | 'History' =>
    ymd(r.effectiveFrom) > thisWeek ? 'Scheduled' : currentIds.has(r.id) ? 'Current' : 'History'
  const fmt = (v: number) => (kind === 'audit' ? `${v} / week` : `${formatUsd(v)} / week`)

  return (
    <div>
      <form onSubmit={addToStaged} noValidate>
        <div>
          <label style={label}>Vintage (pick one or more)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {groupOptions.map((g) => (
              <label key={g.value} style={{ ...chip, ...(groups.includes(g.value) ? chipOn : {}) }}>
                <input type="checkbox" checked={groups.includes(g.value)} onChange={() => toggle(groups, setGroups, g.value)} style={{ display: 'none' }} />
                {g.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '12px' }}>
          <label style={label}>Team (pick one or more, or all)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <label style={{ ...chip, ...(allTeams ? chipOn : {}) }}>
              <input type="checkbox" checked={allTeams} onChange={() => { setAllTeams((v) => !v); setSelectedTeams([]) }} style={{ display: 'none' }} />
              All teams
            </label>
            {teams.map((t) => (
              <label key={t} style={{ ...chip, ...(selectedTeams.includes(t) ? chipOn : {}), ...(allTeams ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}>
                <input type="checkbox" checked={selectedTeams.includes(t)} disabled={allTeams}
                  onChange={() => toggle(selectedTeams, setSelectedTeams, t)} style={{ display: 'none' }} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', alignItems: 'end', marginTop: '12px' }}>
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
          <div>
            <button type="submit" style={{ padding: '9px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--brand)', background: 'var(--brand-light)', color: 'var(--brand)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
              Add to list
            </button>
          </div>
        </div>
      </form>

      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
        A team-specific target beats an &quot;All teams&quot; one. Past weeks are never changed — &quot;This sales week&quot; only affects the week in progress.
        Nothing is saved until you press <b>Save all</b> below, so you can add several, adjust the numbers, and cross-check before committing.
      </p>

      {staged.length > 0 && (
        <div style={{ marginTop: '16px', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Not yet saved ({staged.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {staged.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', flexWrap: 'wrap' }}>
                <span style={{ minWidth: '90px' }}>{s.groupLabel}</span>
                <span style={{ minWidth: '110px', color: 'var(--text-muted)' }}>{s.team ?? 'All teams'}</span>
                <input
                  style={{ ...field, width: '110px' }}
                  inputMode="decimal"
                  value={s.value}
                  onChange={(e) => updateStagedValue(s.key, e.target.value)}
                />
                <span style={{ color: 'var(--text-muted)' }}>{kind === 'audit' ? '/ week' : 'USD / week'}</span>
                <select
                  value={s.from}
                  onChange={(e) => setStaged((prev) => prev.map((x) => (x.key === s.key ? { ...x, from: e.target.value as 'current' | 'next' } : x)))}
                  style={{ ...field, width: 'auto', fontSize: '12px', padding: '4px 8px' }}
                >
                  <option value="next">Next sales week</option>
                  <option value="current">This sales week</option>
                </select>
                <button type="button" onClick={() => removeStaged(s.key)} aria-label="Remove"
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--alert)', cursor: 'pointer', fontSize: '13px' }}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={saveAll} disabled={pending}
            style={{ marginTop: '12px', padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
            {pending ? 'Saving…' : `Save all (${staged.length})`}
          </button>
        </div>
      )}

      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: '13px', marginTop: '10px', color: msg.ok ? 'var(--status-green)' : 'var(--alert)' }}>{msg.text}</div>}

      <div style={{ marginTop: '16px' }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No targets set yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
              <thead><tr><th style={th}>Vintage</th><th style={th}>Team</th><th style={th}>Target</th><th style={th}>From week</th><th style={th} /><th style={th} /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const state = stateOf(r)
                  return (
                    <tr key={r.id} style={{ opacity: state === 'History' ? 0.55 : 1 }}>
                      <td style={td}>{r.isOjt ? 'OJT' : r.vintageLabel}</td>
                      <td style={td}>{r.teamName ?? 'All teams'}</td>
                      <td style={td}><b>{fmt(r.value)}</b></td>
                      <td style={td}>{ymd(r.effectiveFrom)}</td>
                      <td style={td}>{state}</td>
                      <td style={td}>
                        {state !== 'History' && (
                          <button type="button" onClick={() => editRow(r, state)}
                            style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0 }}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
