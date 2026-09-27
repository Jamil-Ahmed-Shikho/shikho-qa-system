'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { createSessionAction, updateSessionAction } from '@/lib/calibration/actions'
import {
  KIND_LABELS,
  eligibleCandidates,
  validateSession,
  type CalibrationKind,
  type Candidate,
  type ItemType,
} from '@/lib/calibration/validation'

export interface RubricChoice { id: string; name: string }

interface Props {
  mode: 'create' | 'edit'
  sessionId?: string
  candidates: Candidate[]
  rubrics: RubricChoice[]
  rubricByTeam: Record<string, string>
  teams: readonly string[]
  sites: readonly string[]
  viewerId: string
  initial: {
    kind: CalibrationKind
    title: string
    itemType: ItemType
    itemReference: string
    leadId: string
    callId: string
    rubricId: string
    teamName: string
    siteName: string
    scheduledLocal: string
    participantIds: string[]
  }
}

const field: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '14px', borderRadius: 'var(--radius-md)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit',
}
const label: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 500, margin: '14px 0 4px' }
const ROLE_LABEL: Record<string, string> = { qa_auditor: 'QA Auditor', qa_manager: 'QA Manager', super_admin: 'Super Admin', team_lead: 'Team Lead' }

export function SessionForm({ mode, sessionId, candidates, rubrics, rubricByTeam, teams, sites, viewerId, initial }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const locked = mode === 'edit' // scope, kind, item and rubric are fixed once scheduled
  const dirty = !saved && JSON.stringify(v) !== JSON.stringify(initial)
  useUnsavedGuard(dirty)

  const pool = useMemo(
    () => eligibleCandidates(candidates, v.kind, v.teamName, v.siteName).filter((c) => c.id !== viewerId),
    [candidates, v.kind, v.teamName, v.siteName, viewerId]
  )
  // Anyone already ticked who is no longer eligible after a scope/kind change is dropped, never silently kept.
  const poolIds = new Set(pool.map((c) => c.id))
  const chosen = v.participantIds.filter((id) => poolIds.has(id))

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }))
  const toggle = (id: string) => set('participantIds', chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])

  function onTeam(team: string) {
    setV((p) => ({ ...p, teamName: team, rubricId: rubricByTeam[team] ?? p.rubricId }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const input = { ...v, participantIds: chosen }
    const bad = validateSession(input, candidates)
    if (bad) return setError(bad)
    start(async () => {
      const res = mode === 'create'
        ? await createSessionAction(input)
        : await updateSessionAction(sessionId!, input.title, input.scheduledLocal, chosen)
      if (!res.ok) return setError(res.error)
      setSaved(true)
      router.push(mode === 'create' && 'id' in res ? `/calibration/${res.id}` : `/calibration/${sessionId}`)
      router.refresh()
    })
  }

  const scopeReady = v.teamName && v.siteName
  const qa = pool.filter((c) => c.role !== 'team_lead')
  const tls = pool.filter((c) => c.role === 'team_lead')

  return (
    <form onSubmit={submit} style={{ maxWidth: '640px' }} noValidate>
      <label style={label}>Kind of session</label>
      <div style={{ display: 'grid', gap: '6px' }}>
        {(['team', 'qa_only'] as const).map((k) => (
          <label key={k} style={{ display: 'flex', gap: '8px', fontSize: '14px', opacity: locked ? 0.7 : 1 }}>
            <input type="radio" name="kind" checked={v.kind === k} disabled={locked} onChange={() => set('kind', k)} />
            {KIND_LABELS[k]}
          </label>
        ))}
      </div>

      <label style={label} htmlFor="cal-title">Title (optional)</label>
      <input id="cal-title" style={field} maxLength={100} value={v.title} onChange={(e) => set('title', e.target.value)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label style={label} htmlFor="cal-team">Team / channel</label>
          <select id="cal-team" style={field} value={v.teamName} disabled={locked} onChange={(e) => onTeam(e.target.value)}>
            <option value="">Choose…</option>
            {teams.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="cal-site">Site</label>
          <select id="cal-site" style={field} value={v.siteName} disabled={locked} onChange={(e) => set('siteName', e.target.value)}>
            <option value="">Choose…</option>
            {sites.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <label style={label} htmlFor="cal-rubric">Rubric</label>
      <select id="cal-rubric" style={field} value={v.rubricId} disabled={locked} onChange={(e) => set('rubricId', e.target.value)}>
        <option value="">Choose…</option>
        {rubrics.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>

      <label style={label}>What is being calibrated</label>
      {v.itemType === 'call' ? (
        v.callId ? (
          <div style={{ fontSize: '14px' }}>Call <b>{v.callId}</b> on lead <b>{v.leadId}</b>.</div>
        ) : (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Pick a call first: open a lead in <b>Audit a Call</b> and press <b>Calibrate</b> on the call — or choose a chat / complaint below.
          </div>
        )
      ) : (
        <input style={field} placeholder="Chat link or complaint ID" maxLength={500} value={v.itemReference}
          disabled={locked} onChange={(e) => set('itemReference', e.target.value)} aria-label="Chat link or complaint ID" />
      )}
      {!locked && !v.callId && (
        <div style={{ marginTop: '6px', fontSize: '13px' }}>
          {(['call', 'chat', 'complaint'] as const).map((t) => (
            <label key={t} style={{ marginRight: '14px' }}>
              <input type="radio" name="itemType" checked={v.itemType === t} onChange={() => set('itemType', t)} /> {t}
            </label>
          ))}
        </div>
      )}

      <label style={label} htmlFor="cal-when">Date and time (Dhaka time)</label>
      <input id="cal-when" type="datetime-local" style={field} value={v.scheduledLocal} onChange={(e) => set('scheduledLocal', e.target.value)} />

      <label style={label}>Who is invited</label>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
        You take part automatically. {v.kind === 'team'
          ? 'Team Leads are listed only when they belong to exactly this team and site.'
          : 'QA-only sessions include QA staff only.'} At least one QA Auditor must take part.
      </div>
      {!scopeReady && v.kind === 'team' ? (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Choose the team and site to see who can be invited.</div>
      ) : (
        <div style={{ display: 'grid', gap: '4px', padding: '10px 12px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }}>
          {[...qa, ...tls].map((c) => (
            <label key={c.id} style={{ display: 'flex', gap: '8px', fontSize: '14px' }}>
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.name} <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{ROLE_LABEL[c.role] ?? c.role}</span>
            </label>
          ))}
          {pool.length === 0 && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody else is available to invite.</div>}
        </div>
      )}

      {error && <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px', marginTop: '12px' }}>{error}</div>}
      <button type="submit" disabled={pending}
        style={{ marginTop: '18px', padding: '10px 20px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Saving…' : mode === 'create' ? 'Schedule session' : 'Save changes'}
      </button>
    </form>
  )
}
