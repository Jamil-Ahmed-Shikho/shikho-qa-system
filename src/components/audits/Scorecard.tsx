'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveScorecardDraft, submitScorecard } from '@/lib/audits/scoring-actions'
import { VoiceInputButton } from '@/components/common/VoiceInputButton'
import { SpecialChecks } from './SpecialChecks'
import type { SpecialCampaign } from '@/lib/campaigns/special'
import {
  FEEDBACK_LIMITS,
  ROOT_CAUSES,
  ROOT_CAUSE_LABELS,
  marksFromPayload,
  scoreAudit,
  toPayload,
  type Issue,
  type Marks,
  type MarksPayload,
  type ParameterMark,
  type RootCause,
  type ScorecardParameter,
  type ScorecardRubric,
} from '@/lib/audits/scoring'

// Long-hand border properties only: this style is overridden per state
// (borderColor / borderWidth), and React warns about — and can mis-apply —
// a shorthand `border` mixed with long-hand overrides on re-render.
const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}

export function Scorecard({
  auditId,
  rubric,
  savedPayload,
  passMark,
  special,
  agentTeam,
}: {
  auditId: string
  rubric: ScorecardRubric
  savedPayload: MarksPayload
  passMark: number | null
  /** Special Check campaigns the auditor can pick for this agent, plus any already attached. */
  special: SpecialCampaign[]
  agentTeam: string | null
}) {
  const router = useRouter()
  const [marks, setMarks] = useState<Marks>(() => marksFromPayload(savedPayload))
  // Compared against the CURRENT payload, so build it the same way (same order, same normalising)
  // rather than trusting the row order the database happened to return.
  const [lastSaved, setLastSaved] = useState(() => JSON.stringify(toPayload(rubric, marksFromPayload(savedPayload), special)))
  // The Special Check section starts open when the draft already has a campaign attached.
  const [specialOn, setSpecialOn] = useState(() => (savedPayload.campaigns ?? []).length > 0)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saving, startSave] = useTransition()
  const [submitting, startSubmit] = useTransition()

  const score = useMemo(() => scoreAudit(rubric, marks, passMark, special), [rubric, marks, passMark, special])
  const payload = useMemo(() => toPayload(rubric, marks, special), [rubric, marks, special])
  const specialAttached = Object.keys(marks.campaigns).length
  const dirty = JSON.stringify(payload) !== lastSaved
  const busy = saving || submitting

  // Don't lose an hour's scoring to a stray refresh or closed tab.
  useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  // ── marking ───────────────────────────────────────────────
  function setResult(p: ScorecardParameter, result: 'pass' | 'fail') {
    const current = marks.parameters[p.id]
    if (result === 'pass' && current) {
      // Pass means "nothing went wrong", so the ticks and the note go with it.
      const lost = [
        Object.keys(current.ticks).length > 0 && 'the error attributes you ticked',
        (current.feedback ?? '').trim() !== '' && 'the feedback you wrote',
      ].filter(Boolean)
      if (lost.length > 0 && !confirm(`Marking "${p.name}" as Pass clears ${lost.join(' and ')}. Continue?`)) return
    }
    setMarks((m) => {
      const cur = m.parameters[p.id]
      const next: ParameterMark = result === 'fail'
        ? { ...cur, result: 'fail', ticks: cur?.ticks ?? {} }
        : { result: 'pass', ticks: {} }
      return { ...m, parameters: { ...m.parameters, [p.id]: next } }
    })
  }

  function toggleTick(parameterId: string, attributeId: string) {
    setMarks((m) => {
      const cur: ParameterMark = m.parameters[parameterId] ?? { result: 'fail', ticks: {} }
      const ticks = { ...cur.ticks }
      if (attributeId in ticks) delete ticks[attributeId]
      else ticks[attributeId] = null
      return { ...m, parameters: { ...m.parameters, [parameterId]: { ...cur, result: 'fail', ticks } } }
    })
  }

  // Feedback text. Voice input hands back one finished phrase at a time, so
  // appending goes through the latest state (never a stale copy) and stays
  // within the limit — the textarea's own maxLength can't stop a programmatic
  // append.
  function setParamFeedback(parameterId: string, text: string) {
    setMarks((m) => {
      const cur = m.parameters[parameterId]
      if (!cur || cur.result !== 'fail') return m
      return { ...m, parameters: { ...m.parameters, [parameterId]: { ...cur, feedback: text } } }
    })
  }
  function appendParamFeedback(parameterId: string, spoken: string) {
    setMarks((m) => {
      const cur = m.parameters[parameterId]
      if (!cur || cur.result !== 'fail') return m
      return { ...m, parameters: { ...m.parameters, [parameterId]: { ...cur, feedback: appendText(cur.feedback ?? '', spoken, FEEDBACK_LIMITS.parameter) } } }
    })
  }
  function setOverall(text: string) {
    setMarks((m) => ({ ...m, overallFeedback: text }))
  }
  function appendOverall(spoken: string) {
    setMarks((m) => ({ ...m, overallFeedback: appendText(m.overallFeedback, spoken, FEEDBACK_LIMITS.overall) }))
  }

  function setCause(parameterId: string, attributeId: string, cause: RootCause) {
    setMarks((m) => {
      const cur = m.parameters[parameterId]
      if (!cur) return m
      return { ...m, parameters: { ...m.parameters, [parameterId]: { ...cur, ticks: { ...cur.ticks, [attributeId]: cause } } } }
    })
  }

  function toggleFatal(id: string) {
    if (marks.fatals.includes(id) && (marks.fatalFeedback[id] ?? '').trim() !== '') {
      if (!confirm('Unticking this fatal error clears the feedback you wrote for it. Continue?')) return
    }
    setMarks((m) => {
      if (!m.fatals.includes(id)) return { ...m, fatals: [...m.fatals, id] }
      const { [id]: _dropped, ...rest } = m.fatalFeedback
      return { ...m, fatals: m.fatals.filter((x) => x !== id), fatalFeedback: rest }
    })
  }
  function setFatalFeedback(id: string, text: string) {
    setMarks((m) => (m.fatals.includes(id) ? { ...m, fatalFeedback: { ...m.fatalFeedback, [id]: text } } : m))
  }
  function appendFatalFeedback(id: string, spoken: string) {
    setMarks((m) => (m.fatals.includes(id)
      ? { ...m, fatalFeedback: { ...m.fatalFeedback, [id]: appendText(m.fatalFeedback[id] ?? '', spoken, FEEDBACK_LIMITS.fatal) } }
      : m))
  }

  // ── Special Checks (never part of the score) ──────────────
  const answeredCount = (campaignId: string) => Object.values(marks.campaigns[campaignId] ?? {}).filter(Boolean).length

  function toggleSpecialEnabled(on: boolean) {
    if (!on && specialAttached > 0) {
      const answers = Object.keys(marks.campaigns).reduce((n, id) => n + answeredCount(id), 0)
      if (!confirm(`Turning off the Special Check removes ${specialAttached} campaign${specialAttached === 1 ? '' : 's'}${answers > 0 ? ` and the ${answers} answer${answers === 1 ? '' : 's'} you picked` : ''} from this audit. Continue?`)) return
      setMarks((m) => ({ ...m, campaigns: {} }))
    }
    setSpecialOn(on)
  }

  function toggleCampaign(campaignId: string) {
    const attached = campaignId in marks.campaigns
    const answers = answeredCount(campaignId)
    if (attached && answers > 0) {
      const name = special.find((c) => c.id === campaignId)?.name ?? 'this campaign'
      if (!confirm(`Removing "${name}" clears the ${answers} answer${answers === 1 ? '' : 's'} you picked for it. Continue?`)) return
    }
    setMarks((m) => {
      if (campaignId in m.campaigns) {
        const { [campaignId]: _removed, ...rest } = m.campaigns
        return { ...m, campaigns: rest }
      }
      return { ...m, campaigns: { ...m.campaigns, [campaignId]: {} } }
    })
  }

  function setSpecialAnswer(campaignId: string, checkId: string, optionId: string) {
    setMarks((m) => {
      if (!(campaignId in m.campaigns)) return m
      const answers = { ...m.campaigns[campaignId] }
      if (optionId) answers[checkId] = optionId
      else delete answers[checkId]
      return { ...m, campaigns: { ...m.campaigns, [campaignId]: answers } }
    })
  }

  // ── saving / submitting ───────────────────────────────────
  function handleSave() {
    setError(null)
    startSave(async () => {
      const res = await saveScorecardDraft(auditId, payload)
      if (!res.ok) return setError(res.error)
      setLastSaved(JSON.stringify(payload))
      setSavedAt(new Date())
    })
  }

  function handleSubmit() {
    if (!score.ready) return
    const verdict = score.criticalFail
      ? 'A Critical fatal error is ticked, so this audit will score 0%.'
      : `It will score ${score.percent}%${passMark !== null ? ` (${score.passed ? 'pass' : 'not a pass'} at the ${passMark}% mark)` : ''}.`
    if (!confirm(`Submit this audit? ${verdict}\n\nOnce submitted it can't be changed.`)) return
    setError(null)
    startSubmit(async () => {
      const res = await submitScorecard(auditId, payload)
      if (!res.ok) return setError(res.error)
      setLastSaved(JSON.stringify(payload))
      router.refresh() // the page re-renders as the read-only submitted result
    })
  }

  // An issue is about one parameter, one fatal error, one Special Check answer, or
  // the overall feedback (its length limit, or being required once a campaign is attached). The rubric-points problem is shown separately and
  // never reaches this list.
  function goTo(issue: Issue) {
    const id = issue.parameterId ? `param-${issue.parameterId}`
      : issue.fatalId ? `fatal-${issue.fatalId}`
      : issue.campaignId && issue.checkId ? `special-${issue.campaignId}-${issue.checkId}`
      : 'overall-feedback'
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const pctDone = score.totalCount > 0 ? (score.scoredCount / score.totalCount) * 100 : 0
  const critical = rubric.fatals.filter((f) => f.severity === 'critical')
  const major = rubric.fatals.filter((f) => f.severity === 'major')
  const mismatch = score.issues.find((i) => i.kind === 'rubric_points_mismatch')
  const remaining = score.issues.filter((i) => i.kind !== 'rubric_points_mismatch')

  return (
    <div>
      {/* ── live score ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, background: 'var(--paper)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '16px',
        boxShadow: '0 4px 12px rgba(15,19,34,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '26px', fontWeight: 700, color: score.criticalFail ? 'var(--alert)' : 'var(--text-primary)' }}>
              {score.percent}%
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {score.earned} / {score.possible} pts
            </span>
            {score.criticalFail ? (
              <Chip bg="var(--alert-light)" color="var(--alert)">
                Critical fatal ticked — scores 0% (parameters alone: {score.parametersPercent}%)
              </Chip>
            ) : score.ready && passMark !== null ? (
              <Chip bg={score.passed ? '#E5F5EC' : 'var(--alert-light)'} color={score.passed ? 'var(--status-green)' : 'var(--alert)'}>
                {score.passed ? `Would pass (mark ${passMark}%)` : `Below the pass mark (${passMark}%)`}
              </Chip>
            ) : (
              <Chip bg="var(--surface-1)" color="var(--text-muted)">
                {score.scoredCount} of {score.totalCount} parameters scored
              </Chip>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {dirty ? 'Unsaved changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
            </span>
            <button onClick={handleSave} disabled={!dirty || busy} style={{ ...btn, ...(!dirty || busy ? btnOff : {}) }}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
        <div style={{ height: '4px', background: 'var(--surface-1)', borderRadius: '2px', marginTop: '10px', overflow: 'hidden' }}>
          <div style={{ width: `${pctDone}%`, height: '100%', background: 'var(--brand)', transition: 'width 0.2s' }} />
        </div>
      </div>

      {mismatch && (
        <div style={{ ...card, borderColor: 'var(--alert)', background: 'var(--alert-light)', color: 'var(--alert)', fontSize: '13px', marginBottom: '16px' }}>
          {mismatch.message}
        </div>
      )}

      {/* ── parameters ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {rubric.categories.map((cat) => (
          <section key={cat.id}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {cat.name}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {cat.parameters.map((p) => (
                <ParameterCard
                  key={p.id}
                  parameter={p}
                  mark={marks.parameters[p.id]}
                  onResult={(r) => setResult(p, r)}
                  onTick={(aid) => toggleTick(p.id, aid)}
                  onCause={(aid, c) => setCause(p.id, aid, c)}
                  onFeedback={(text) => setParamFeedback(p.id, text)}
                  onSpoken={(text) => appendParamFeedback(p.id, text)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ── fatal errors ── */}
      <section style={{ ...card, marginTop: '24px', borderColor: score.criticalFail ? 'var(--alert)' : 'var(--border)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Fatal errors</h3>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Scored separately from the parameters above. Any <b style={{ color: 'var(--alert)' }}>Critical</b> ticked
          sets the whole audit to 0%. A <b style={{ color: 'var(--text-primary)' }}>Major</b> is recorded but doesn&apos;t change the score.
          Every fatal error you tick needs feedback explaining it.
        </p>
        {rubric.fatals.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>This rubric has no fatal errors defined.</p>}
        <FatalGroup title="Critical" color="var(--alert)" items={critical} ticked={marks.fatals} feedback={marks.fatalFeedback} onToggle={toggleFatal} onFeedback={setFatalFeedback} onSpoken={appendFatalFeedback} />
        <FatalGroup title="Major" color="var(--highlight)" items={major} ticked={marks.fatals} feedback={marks.fatalFeedback} onToggle={toggleFatal} onFeedback={setFatalFeedback} onSpoken={appendFatalFeedback} />
      </section>

      {/* ── special check (optional) ── */}
      <SpecialChecks
        campaigns={special}
        attached={marks.campaigns}
        enabled={specialOn}
        agentTeam={agentTeam}
        onToggleEnabled={toggleSpecialEnabled}
        onToggleCampaign={toggleCampaign}
        onAnswer={setSpecialAnswer}
      />

      {/* ── overall feedback (optional — required once a Special Check is attached) ── */}
      <section id="overall-feedback" style={{ ...card, marginTop: '24px', scrollMarginTop: '110px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
          Overall feedback{' '}
          {specialAttached > 0
            ? <span style={{ color: 'var(--alert)' }} title="Required while a Special Check is attached">*</span>
            : <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '13px' }}>(optional)</span>}
          {specialAttached > 0 && marks.overallFeedback.trim() === '' && <span style={{ color: 'var(--alert)', fontWeight: 500, fontSize: '13px' }}> — required</span>}
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
          A short coaching summary for the agent — what went well and what to work on overall.
          The feedback on each failed parameter is what the agent acts on; this is the wider picture.
          {specialAttached > 0 && <> <b style={{ color: 'var(--text-secondary)' }}>It is required here because a Special Check is attached</b> — it gives the agent the context for that check.</>}
          {' '}You can type it or use the microphone.
        </p>
        <FeedbackField
          label="Overall feedback"
          value={marks.overallFeedback}
          max={FEEDBACK_LIMITS.overall}
          minHeight={110}
          placeholder="e.g. Good rapport and clear pricing explanation. Next time confirm the student's class and group before recommending a course, and always close with the next step."
          onChange={setOverall}
          onSpoken={appendOverall}
        />
      </section>

      {/* ── submit ── */}
      <section style={{ ...card, marginTop: '24px' }}>
        {remaining.length > 0 && (
          <details style={{ marginBottom: '14px' }} open={score.scoredCount === score.totalCount}>
            <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Still needed before you can submit ({remaining.length})
            </summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {remaining.slice(0, 40).map((i, idx) => (
                <li key={idx}>
                  {i.message}{' '}
                  {i.kind !== 'rubric_points_mismatch' && (
                    <button onClick={() => goTo(i)} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: 0 }}>
                      Go to
                    </button>
                  )}
                </li>
              ))}
              {remaining.length > 40 && <li>…and {remaining.length - 40} more</li>}
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
            disabled={!score.ready || busy}
            title={score.ready ? undefined : 'Finish scoring first — see what is still needed'}
            style={{ ...btn, background: score.ready && !busy ? 'var(--brand)' : 'var(--surface-1)', color: score.ready && !busy ? 'white' : 'var(--text-muted)', padding: '11px 22px', fontSize: '14px', cursor: score.ready && !busy ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? 'Submitting…' : 'Submit audit'}
          </button>
          {!score.ready && !mismatch && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {remaining.length} thing{remaining.length === 1 ? '' : 's'} left to finish
            </span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Scorecard: {rubric.name} v{rubric.version} — locked when this audit was started
          </span>
        </div>
      </section>
    </div>
  )
}

// ── one parameter ────────────────────────────────────────────

function ParameterCard({
  parameter: p,
  mark,
  onResult,
  onTick,
  onCause,
  onFeedback,
  onSpoken,
}: {
  parameter: ScorecardParameter
  mark: ParameterMark | undefined
  onResult: (r: 'pass' | 'fail') => void
  onTick: (attributeId: string) => void
  onCause: (attributeId: string, c: RootCause) => void
  onFeedback: (text: string) => void
  onSpoken: (text: string) => void
}) {
  const result = mark?.result ?? null
  const ticks = mark?.ticks ?? {}
  const tickedCount = Object.keys(ticks).length
  const canFail = p.errorAttributes.length > 0

  const border = result === 'pass' ? '#9BD2B0' : result === 'fail' ? 'var(--alert)' : 'var(--border)'

  return (
    <div id={`param-${p.id}`} style={{ ...card, borderColor: border, borderWidth: result ? '1.5px' : '1px', scrollMarginTop: '110px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{p.name}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {result === 'pass' && `${p.points} / ${p.points} pts`}
            {result === 'fail' && `0 / ${p.points} pts`}
            {result === null && `${p.points} pts`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }} role="group" aria-label={`Score ${p.name}`}>
          <button
            aria-pressed={result === 'pass'}
            onClick={() => onResult('pass')}
            style={{ ...seg, ...(result === 'pass' ? { background: 'var(--status-green)', color: 'white', borderColor: 'var(--status-green)' } : {}) }}
          >
            Pass
          </button>
          <button
            aria-pressed={result === 'fail'}
            onClick={() => onResult('fail')}
            disabled={!canFail}
            title={canFail ? undefined : 'This parameter has no error attributes defined, so it can’t be failed — add some in Rubric Admin.'}
            style={{ ...seg, ...(result === 'fail' ? { background: 'var(--alert)', color: 'white', borderColor: 'var(--alert)' } : {}), ...(!canFail ? btnOff : {}) }}
          >
            Fail
          </button>
        </div>
      </div>

      {result === 'fail' && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border)' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
            What went wrong? Tick every error that applies{tickedCount === 0 && <span style={{ color: 'var(--alert)' }}> — at least one is required</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {p.errorAttributes.map((a) => {
              const ticked = a.id in ticks
              return (
                <div key={a.id}>
                  <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', cursor: 'pointer', lineHeight: 1.5 }}>
                    <input type="checkbox" checked={ticked} onChange={() => onTick(a.id)} style={{ marginTop: '3px' }} />
                    <span>{a.description}</span>
                  </label>
                  {ticked && (
                    <div style={{ marginLeft: '26px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: ticks[a.id] ? 'var(--text-muted)' : 'var(--alert)', fontWeight: 600 }}>
                        Root cause{ticks[a.id] ? '' : ' (required)'}:
                      </span>
                      {ROOT_CAUSES.map((c) => (
                        <button
                          key={c}
                          aria-pressed={ticks[a.id] === c}
                          onClick={() => onCause(a.id, c)}
                          style={{
                            padding: '3px 10px', fontSize: '12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                            border: `1px solid ${ticks[a.id] === c ? 'var(--brand)' : 'var(--border)'}`,
                            background: ticks[a.id] === c ? 'var(--brand)' : 'var(--surface-2)',
                            color: ticks[a.id] === c ? 'white' : 'var(--text-secondary)',
                          }}
                        >
                          {ROOT_CAUSE_LABELS[c]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Required: the ticked errors say WHAT went wrong; this is what the agent is told about it. */}
          <div style={{ marginTop: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Feedback for the agent <span style={{ color: 'var(--alert)' }} title="Required to submit">*</span>
              {(mark?.feedback ?? '').trim() === '' && <span style={{ color: 'var(--alert)' }}> — required</span>}
            </div>
            <FeedbackField
              label={`Feedback on ${p.name}`}
              value={mark?.feedback ?? ''}
              max={FEEDBACK_LIMITS.parameter}
              minHeight={72}
              placeholder="What should the agent hear about this one — what happened and what to do differently?"
              onChange={onFeedback}
              onSpoken={onSpoken}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Adds a spoken phrase to what's already written, within the limit.
function appendText(current: string, spoken: string, max: number): string {
  const joined = (current.trim() ? current.trim() + ' ' : '') + spoken
  return Array.from(joined).slice(0, max).join('')
}

// A textarea with the CMS voice-input button (Bangla by default, EN toggle)
// and a character counter. Leave the right padding: the mic and language
// toggle sit over the bottom-right corner.
function FeedbackField({
  label, value, max, minHeight, placeholder, onChange, onSpoken,
}: {
  label: string
  value: string
  max: number
  minHeight: number
  placeholder: string
  onChange: (text: string) => void
  onSpoken: (text: string) => void
}) {
  const used = Array.from(value).length
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <textarea
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={max}
          placeholder={placeholder}
          style={{
            width: '100%', minHeight, resize: 'vertical', padding: '10px 92px 10px 12px', fontSize: '13px', lineHeight: 1.6,
            fontFamily: 'inherit', color: 'var(--text-primary)', background: 'var(--surface-2)',
            borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-md)',
          }}
        />
        <VoiceInputButton onTranscript={onSpoken} />
      </div>
      <div style={{ textAlign: 'right', fontSize: '11px', marginTop: '4px', color: used >= max ? 'var(--alert)' : 'var(--text-muted)' }}>
        {used} / {max}
      </div>
    </div>
  )
}

function FatalGroup({
  title, color, items, ticked, feedback, onToggle, onFeedback, onSpoken,
}: {
  title: string
  color: string
  items: { id: string; description: string }[]
  ticked: string[]
  feedback: Record<string, string>
  onToggle: (id: string) => void
  onFeedback: (id: string, text: string) => void
  onSpoken: (id: string, text: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
        {title} ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((f) => {
          const on = ticked.includes(f.id)
          const text = feedback[f.id] ?? ''
          return (
            <div key={f.id} id={`fatal-${f.id}`} style={{ scrollMarginTop: '110px' }}>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', cursor: 'pointer', lineHeight: 1.5 }}>
                <input type="checkbox" checked={on} onChange={() => onToggle(f.id)} style={{ marginTop: '3px' }} />
                <span style={{ color: on ? color : undefined, fontWeight: on ? 600 : 400 }}>{f.description}</span>
              </label>
              {on && (
                <div style={{ marginLeft: '26px', marginTop: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Feedback on this fatal error <span style={{ color: 'var(--alert)' }} title="Required to submit">*</span>
                    {text.trim() === '' && <span style={{ color: 'var(--alert)' }}> — required</span>}
                  </div>
                  <FeedbackField
                    label={`Feedback on the fatal error: ${f.description}`}
                    value={text}
                    max={FEEDBACK_LIMITS.fatal}
                    minHeight={80}
                    placeholder="What happened, and where in the call? A quote or timestamp helps."
                    onChange={(t) => onFeedback(f.id, t)}
                    onSpoken={(t) => onSpoken(f.id, t)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)', background: bg, color }}>
      {children}
    </span>
  )
}

const btn: React.CSSProperties = {
  padding: '8px 16px', fontSize: '13px', fontWeight: 500, color: 'var(--brand)', background: 'var(--brand-light)',
  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
}
const btnOff: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' }
const seg: React.CSSProperties = {
  padding: '7px 20px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--surface-2)',
  borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border-strong)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
}
