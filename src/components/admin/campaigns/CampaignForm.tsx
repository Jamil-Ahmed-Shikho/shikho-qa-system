'use client'
// Campaign details: name, description and which teams it applies to.
// Used to create a campaign (then it opens the editor) and to edit its details.

import { useState } from 'react'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { useRouter } from 'next/navigation'
import { createCampaignAction, updateCampaignAction } from '@/lib/campaigns/actions'
import { CAMPAIGN_LIMITS } from '@/lib/campaigns/rules'
import { validateCampaignInput } from '@/lib/campaigns/validation'
import { TEAM_NAMES } from '@/types/database.types'
import { inputStyle, labelStyle, primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export interface CampaignFormValues {
  name: string
  description: string
  allTeams: boolean
  teamNames: string[]
}

export function CampaignForm({
  mode,
  campaignId,
  initial,
}: {
  mode: 'create' | 'edit'
  campaignId?: string
  initial?: CampaignFormValues
}) {
  const router = useRouter()
  const [values, setValues] = useState<CampaignFormValues>(initial ?? { name: '', description: '', allTeams: false, teamNames: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = mode === 'create' || JSON.stringify(values) !== JSON.stringify(initial)
  // "dirty" also enables the button; the guard needs real edits (a fresh create form is not unsaved work).
  const blank = JSON.stringify({ name: '', description: '', allTeams: false, teamNames: [] })
  useUnsavedGuard(JSON.stringify(values) !== (mode === 'create' ? blank : JSON.stringify(initial)))
  const set = (patch: Partial<CampaignFormValues>) => { setValues((v) => ({ ...v, ...patch })); setSaved(false) }
  const toggleTeam = (team: string) =>
    set({ teamNames: values.teamNames.includes(team) ? values.teamNames.filter((t) => t !== team) : [...values.teamNames, team] })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const check = validateCampaignInput(values)
    if (!check.ok) return setError(check.error)

    setBusy(true)
    const res = mode === 'create' ? await createCampaignAction(values) : await updateCampaignAction(campaignId!, values)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    if (mode === 'create' && 'id' in res) return router.push(`/admin/campaigns/${res.id}`)
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <label style={labelStyle} htmlFor="campaign-name">Campaign name</label>
        <input
          id="campaign-name" style={inputStyle} value={values.name} maxLength={CAMPAIGN_LIMITS.name}
          placeholder="e.g. New course launch — October" onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="campaign-description">Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
        <textarea
          id="campaign-description" style={{ ...inputStyle, minHeight: '72px', resize: 'vertical', lineHeight: 1.5 }}
          value={values.description} maxLength={CAMPAIGN_LIMITS.description}
          placeholder="What is this campaign checking, and why?" onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ ...labelStyle, padding: 0 }}>Applies to</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', marginBottom: '8px' }}>
          <input type="checkbox" checked={values.allTeams} onChange={(e) => set({ allTeams: e.target.checked })} />
          <span><b>All teams</b></span>
        </label>
        {!values.allTeams && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Teams">
            {TEAM_NAMES.map((team) => {
              const on = values.teamNames.includes(team)
              return (
                <label
                  key={team}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer',
                    borderRadius: 'var(--radius-pill)', borderStyle: 'solid', borderWidth: '1px',
                    borderColor: on ? 'var(--brand)' : 'var(--border)', background: on ? 'var(--brand-light)' : 'var(--surface-2)',
                    color: on ? 'var(--brand)' : 'var(--text-secondary)', fontWeight: on ? 600 : 400,
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleTeam(team)} style={{ margin: 0 }} />
                  {team}
                </label>
              )
            })}
          </div>
        )}
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          The campaign is offered only on audits of agents in the selected teams.
        </p>
      </fieldset>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', fontSize: '13px', background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', color: 'var(--alert)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button type="submit" disabled={busy || !dirty} style={{ ...primaryBtn, ...(busy || !dirty ? disabledStyle : {}) }}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create campaign' : 'Save details'}
        </button>
        {saved && !dirty && <span style={{ fontSize: '12px', color: 'var(--status-green)' }}>Saved</span>}
        {mode === 'create' && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>You&apos;ll add the checks and their options next.</span>}
      </div>
    </form>
  )
}
