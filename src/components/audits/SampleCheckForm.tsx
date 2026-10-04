'use client'
// ============================================================
// SHIKHO QA SYSTEM — Sample Check draft form (Phase 3, §4/§5)
//
// Deliberately NOT a reskin of <Scorecard>/<SpecialChecks> — a Sample
// Check has no rubric to score, so there is no live score header, no
// parameter list, no fatal section. What IS reused, by calling the exact
// same functions, is QA's existing Campaign/Special-Check mechanism
// (campaigns the agent's team has set up) — just always shown, never
// behind an "optional, off by default" toggle the way the scorecard's own
// Special Check section is, since here it IS the whole point: at least
// one campaign must be ticked to submit (submit_sample_check(), schema_073).
// ============================================================

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveSampleCheckDraft, submitSampleCheck } from '@/lib/audits/sample-check-actions'
import { VoiceInputButton } from '@/components/common/VoiceInputButton'
import { setUnsaved } from '@/lib/ui/unsaved'
import { FEEDBACK_LIMITS } from '@/lib/audits/scoring'
import { emptySampleCheckMarks, marksFromSampleCheckPayload, sampleCheckIssues, toSampleCheckPayload, type SampleCheckMarks } from '@/lib/audits/sample-check'
import type { SpecialCampaign } from '@/lib/campaigns/special'
import type { SampleCheckPayload } from '@/lib/audits/sample-check'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}
const selectStyle: React.CSSProperties = {
  width: '100%', maxWidth: '420px', padding: '9px 12px', fontSize: '13px', fontFamily: 'inherit',
  color: 'var(--text-primary)', background: 'var(--surface-2)', borderStyle: 'solid', borderWidth: '1px',
  borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-sm)',
}
const btn: React.CSSProperties = {
  padding: '9px 16px', fontSize: '13px', fontWeight: 500, borderRadius: 'var(--radius-sm)', borderWidth: '1px',
  borderStyle: 'solid', borderColor: 'var(--border)', background: 'var(--surface-1)', cursor: 'pointer',
}

export function SampleCheckForm({
  auditId,
  campaigns,
  savedPayload,
  agentTeam,
}: {
  auditId: string
  campaigns: SpecialCampaign[]
  savedPayload: SampleCheckPayload
  agentTeam: string | null
}) {
  const router = useRouter()
  const [marks, setMarks] = useState<SampleCheckMarks>(() =>
    savedPayload.campaigns.length > 0 ? marksFromSampleCheckPayload(savedPayload) : emptySampleCheckMarks()
  )
  const [lastSaved, setLastSaved] = useState(() => JSON.stringify(toSampleCheckPayload(marks, campaigns)))
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saving, startSave] = useTransition()
  const [submitting, startSubmit] = useTransition()

  const payload = useMemo(() => toSampleCheckPayload(marks, campaigns), [marks, campaigns])
  const issues = useMemo(() => sampleCheckIssues(marks, campaigns), [marks, campaigns])
  const dirty = JSON.stringify(payload) !== lastSaved
  const busy = saving || submitting
  const ready = issues.length === 0

  useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  useEffect(() => {
    setUnsaved('sample-check', dirty)
    return () => setUnsaved('sample-check', false)
  }, [dirty])

  function toggleCampaign(campaignId: string) {
    setMarks((m) => {
      const next = { ...m.campaigns }
      if (campaignId in next) delete next[campaignId]
      else next[campaignId] = {}
      return { ...m, campaigns: next }
    })
  }
  function setAnswer(campaignId: string, checkId: string, optionId: string) {
    setMarks((m) => {
      if (!(campaignId in m.campaigns)) return m
      const answers = { ...m.campaigns[campaignId] }
      if (optionId) answers[checkId] = optionId
      else delete answers[checkId]
      return { ...m, campaigns: { ...m.campaigns, [campaignId]: answers } }
    })
  }
  function setOverall(text: string) {
    setMarks((m) => ({ ...m, overallFeedback: text }))
  }
  function appendOverall(text: string) {
    setMarks((m) => ({ ...m, overallFeedback: (m.overallFeedback ? `${m.overallFeedback} ` : '') + text }))
  }

  function handleSave() {
    setError(null)
    startSave(async () => {
      const res = await saveSampleCheckDraft(auditId, payload)
      if (!res.ok) return setError(res.error)
      setLastSaved(JSON.stringify(payload))
      setSavedAt(new Date())
    })
  }

  function handleSubmit() {
    if (!ready) return
    if (!confirm('Submit this Sample Check? Once submitted it can\'t be changed.')) return
    setError(null)
    startSubmit(async () => {
      const res = await submitSampleCheck(auditId, payload)
      if (!res.ok) return setError(res.error)
      setLastSaved(JSON.stringify(payload))
      router.refresh()
    })
  }

  const attachedCount = Object.keys(marks.campaigns).length
  const overallUsed = Array.from(marks.overallFeedback).length

  return (
    <div>
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'var(--paper)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '16px', boxShadow: '0 4px 12px rgba(15,19,34,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {attachedCount === 0 ? 'Tick a campaign below to begin' : `${attachedCount} campaign${attachedCount === 1 ? '' : 's'} ticked`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {dirty ? 'Unsaved changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
          </span>
          <button onClick={handleSave} disabled={!dirty || busy} style={{ ...btn, ...(!dirty || busy ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </div>

      <section style={{ ...card }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Special Check</h3>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Tick the campaign(s) you&apos;re checking on this call. A Sample Check has no rubric score —
          this is the whole point of it. Each ticked campaign asks for an answer to every check below it.
        </p>
        {campaigns.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            No Special Check is currently active for {agentTeam ? <>the <b>{agentTeam}</b> team</> : 'this agent'}.
            An admin can set one up under Special Checks.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {campaigns.map((c) => {
              const on = c.id in marks.campaigns
              const answers = marks.campaigns[c.id] ?? {}
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
                    <input type="checkbox" checked={on} onChange={() => toggleCampaign(c.id)} style={{ marginTop: '3px' }} aria-label={`Check campaign: ${c.name}`} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, overflowWrap: 'anywhere' }}>{c.name}</span>
                      {c.archived && (
                        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>
                          Archived — you can still finish this Sample Check
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
                            <select id={selectId} value={chosen} onChange={(e) => setAnswer(c.id, check.id, e.target.value)}
                              style={{ ...selectStyle, ...(missing ? { borderColor: 'var(--alert)' } : {}) }}>
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
        )}
      </section>

      <section id="overall-feedback" style={{ ...card, marginTop: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
          Overall feedback <span style={{ color: 'var(--alert)' }} title="Required for a Sample Check"> *</span>
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          The context for whoever reads this later (QA, the agent&apos;s Team Lead or Manager) — what you checked and what you found.
          You can type it or use the microphone.
        </p>
        <div style={{ position: 'relative' }}>
          <textarea
            aria-label="Overall feedback"
            value={marks.overallFeedback}
            onChange={(e) => setOverall(e.target.value)}
            maxLength={FEEDBACK_LIMITS.overall}
            placeholder="e.g. Checked whether the agent mentioned the HSC'27 Combo offer — they did, but didn't confirm the enrollment deadline."
            style={{
              width: '100%', minHeight: 110, resize: 'vertical', padding: '10px 92px 10px 12px', fontSize: '13px', lineHeight: 1.6,
              fontFamily: 'inherit', color: 'var(--text-primary)', background: 'var(--surface-2)',
              borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-md)',
            }}
          />
          <VoiceInputButton onTranscript={appendOverall} />
        </div>
        <div style={{ textAlign: 'right', fontSize: '11px', marginTop: '4px', color: overallUsed >= FEEDBACK_LIMITS.overall ? 'var(--alert)' : 'var(--text-muted)' }}>
          {overallUsed} / {FEEDBACK_LIMITS.overall}
        </div>
      </section>

      <section style={{ ...card, marginTop: '20px' }}>
        {issues.length > 0 && (
          <details style={{ marginBottom: '14px' }} open>
            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Still needed before you can submit ({issues.length})
            </summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {issues.map((i, idx) => (
                <li key={idx}>
                  {i.message}{' '}
                  {i.campaignId && i.checkId && (
                    <button
                      onClick={() => document.getElementById(`special-${i.campaignId}-${i.checkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                      style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    >
                      Go to
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <div style={{ marginBottom: '12px', padding: '10px 14px', fontSize: '13px', background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', color: 'var(--alert)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleSubmit}
            disabled={!ready || busy}
            title={ready ? undefined : 'Finish the check first — see what is still needed'}
            style={{ ...btn, background: ready && !busy ? 'var(--brand)' : 'var(--surface-1)', color: ready && !busy ? 'white' : 'var(--text-muted)', borderColor: ready && !busy ? 'var(--brand)' : 'var(--border)', padding: '11px 22px', fontSize: '14px', cursor: ready && !busy ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? 'Submitting…' : 'Submit Sample Check'}
          </button>
          {!ready && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {issues.length} thing{issues.length === 1 ? '' : 's'} left to finish
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
