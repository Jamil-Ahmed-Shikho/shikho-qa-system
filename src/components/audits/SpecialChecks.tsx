'use client'
// The optional "Special Check" section of the scorecard.
//
// Off by default. Turn it on to see the campaigns that apply to this agent's team;
// tick one or more, and each of their checks asks for one answer from a fixed list
// (no free text). Only ticked campaigns ask for anything. None of it affects the score.

import type { SpecialCampaign } from '@/lib/campaigns/special'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}

const selectStyle: React.CSSProperties = {
  width: '100%', maxWidth: '420px', padding: '9px 12px', fontSize: '13px', fontFamily: 'inherit',
  color: 'var(--text-primary)', background: 'var(--surface-2)', borderStyle: 'solid', borderWidth: '1px',
  borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-sm)',
}

export function SpecialChecks({
  campaigns,
  attached,
  enabled,
  agentTeam,
  onToggleEnabled,
  onToggleCampaign,
  onAnswer,
}: {
  campaigns: SpecialCampaign[]
  /** campaign id -> (check id -> chosen option id) for the campaigns ticked on this audit */
  attached: Record<string, Record<string, string>>
  enabled: boolean
  agentTeam: string | null
  onToggleEnabled: (on: boolean) => void
  onToggleCampaign: (campaignId: string) => void
  /** optionId '' clears the answer */
  onAnswer: (campaignId: string, checkId: string, optionId: string) => void
}) {
  const attachedCount = Object.keys(attached).length

  return (
    <section id="special-checks" style={{ ...card, marginTop: '24px', scrollMarginTop: '110px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
            Special Check <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '13px' }}>(optional)</span>
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', maxWidth: '620px' }}>
            Temporary checks set by management — for example, whether the agent mentioned a new course launch.
            They are recorded with this audit but <b style={{ color: 'var(--text-secondary)' }}>never change its score</b>.
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggleEnabled(e.target.checked)} aria-label="Add a Special Check to this audit" />
          Add a Special Check
        </label>
      </div>

      {enabled && (
        <div style={{ marginTop: '14px', borderTop: '1px dashed var(--border)', paddingTop: '14px' }}>
          {campaigns.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              No Special Check is currently active for {agentTeam ? <>the <b>{agentTeam}</b> team</> : 'this agent'}. An admin can set one up under Special Checks.
            </p>
          ) : (
            <>
              <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                Tick the campaign(s) you are checking on this call. Each one asks for an answer to every check below it.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {campaigns.map((c) => {
                  const on = c.id in attached
                  const answers = attached[c.id] ?? {}
                  return (
                    <div
                      key={c.id}
                      id={`special-${c.id}`}
                      style={{
                        borderStyle: 'solid', borderWidth: on ? '1.5px' : '1px', borderColor: on ? 'var(--brand)' : 'var(--border)',
                        borderRadius: 'var(--radius-md)', padding: '12px 14px', background: on ? 'var(--brand-light)' : 'var(--surface-2)',
                      }}
                    >
                      <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={() => onToggleCampaign(c.id)} style={{ marginTop: '3px' }} aria-label={`Check campaign: ${c.name}`} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontSize: '14px', fontWeight: 600, overflowWrap: 'anywhere' }}>{c.name}</span>
                          {c.archived && (
                            <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>
                              Archived — you can still finish this audit
                            </span>
                          )}
                          {c.description && <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{c.description}</span>}
                        </span>
                      </label>

                      {on && (
                        <div style={{ marginTop: '12px', marginLeft: '26px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {c.checks.length === 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>This campaign has no active checks to answer.</span>}
                          {c.checks.map((check) => {
                            const chosen = answers[check.id] ?? ''
                            const missing = check.required && !chosen
                            const selectId = `special-${c.id}-${check.id}`
                            return (
                              <div key={check.id}>
                                <label htmlFor={selectId} style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                                  {check.name}
                                  {check.required && <span style={{ color: 'var(--alert)' }} title="Required to submit"> *</span>}
                                  {missing && <span style={{ color: 'var(--alert)', fontWeight: 500 }}> — choose an answer</span>}
                                </label>
                                {check.description && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>{check.description}</div>}
                                <select
                                  id={selectId}
                                  value={chosen}
                                  onChange={(e) => onAnswer(c.id, check.id, e.target.value)}
                                  style={{ ...selectStyle, ...(missing ? { borderColor: 'var(--alert)' } : {}) }}
                                >
                                  <option value="">Choose…</option>
                                  {check.options.map((o) => (
                                    <option key={o.id} value={o.id}>{o.label}{o.archived ? ' (archived)' : ''}</option>
                                  ))}
                                </select>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {attachedCount > 0 && (
        <p style={{ margin: '14px 0 0', padding: '10px 14px', fontSize: '12px', lineHeight: 1.6, background: 'var(--highlight-light)', border: '1px solid var(--highlight)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
          <b>Overall feedback is now required.</b> When a Special Check is attached, the overall feedback gives the agent the context for it.
        </p>
      )}
    </section>
  )
}
