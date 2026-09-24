import {
  ROOT_CAUSE_LABELS,
  marksFromPayload,
  type MarksPayload,
  type RootCause,
  type ScorecardRubric,
} from '@/lib/audits/scoring'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { chosenLabel, type SpecialCampaign } from '@/lib/campaigns/special'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}

// The submitted result, read-only. The headline numbers are the ones the
// database stored at submission (never recomputed here), so this can't
// disagree with what was recorded — even if the pass mark or the rubric
// changes later.
export function ScorecardSummary({
  rubric,
  saved,
  score,
  special,
}: {
  rubric: ScorecardRubric
  saved: MarksPayload
  /** The Special Check campaigns attached to this audit, with the checks that were answered. */
  special: SpecialCampaign[]
  score: {
    score_percent: number | null
    passed: boolean | null
    critical_fail: boolean
    pass_mark_used: number | null
    submitted_at: string | null
  }
}) {
  const marks = marksFromPayload(saved)
  const attrText = new Map(rubric.categories.flatMap((c) => c.parameters.flatMap((p) => p.errorAttributes.map((a) => [a.id, a.description] as const))))
  const fatalsHit = rubric.fatals.filter((f) => marks.fatals.includes(f.id))
  const criticalHit = fatalsHit.filter((f) => f.severity === 'critical')
  const majorHit = fatalsHit.filter((f) => f.severity === 'major')
  const pct = score.score_percent

  return (
    <div>
      <section style={{ ...card, marginBottom: '16px', borderColor: score.passed ? '#9BD2B0' : 'var(--alert)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '34px', fontWeight: 700, color: score.critical_fail ? 'var(--alert)' : 'var(--text-primary)' }}>
            {pct ?? '—'}%
          </span>
          {score.passed !== null && (
            <span style={{
              fontSize: '13px', fontWeight: 700, padding: '5px 14px', borderRadius: 'var(--radius-pill)',
              background: score.passed ? '#E5F5EC' : 'var(--alert-light)', color: score.passed ? 'var(--status-green)' : 'var(--alert)',
            }}>
              {score.passed ? 'PASSED' : 'NOT PASSED'}
            </span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {score.pass_mark_used !== null && `Pass mark at submission: ${score.pass_mark_used}%`}
            {score.submitted_at && ` · Submitted ${formatDhakaDateTime(score.submitted_at)}`}
          </span>
        </div>

        {score.critical_fail && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--alert)' }}>
            <b>Critical fatal error — this audit scores 0%.</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
              {criticalHit.map((f) => <li key={f.id}>{f.description}<FatalNote text={marks.fatalFeedback[f.id]} /></li>)}
            </ul>
          </div>
        )}
        {majorHit.length > 0 && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'var(--text-primary)' }}>
            <b>Major fatal error recorded (score unaffected)</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
              {majorHit.map((f) => <li key={f.id}>{f.description}<FatalNote text={marks.fatalFeedback[f.id]} /></li>)}
            </ul>
          </div>
        )}
      </section>

      <section style={{ ...card, marginBottom: '18px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Overall feedback
        </h3>
        {marks.overallFeedback.trim() ? (
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{marks.overallFeedback}</p>
        ) : (
          // Overall feedback is optional (schema_013), so this is a normal state.
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>No overall feedback was written for this audit.</p>
        )}
      </section>

      {special.length > 0 && (
        <section style={{ ...card, marginBottom: '18px' }} aria-label="Special Check">
          <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Special Check
          </h3>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-muted)' }}>Recorded with this audit — not part of the score.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {special.map((c) => (
              <div key={c.id}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {c.name}
                  {c.archived && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>Archived</span>}
                </div>
                {c.checks.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>No answers were recorded for this campaign.</div>
                ) : (
                  <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px', lineHeight: 1.7, color: 'var(--text-primary)' }}>
                    {c.checks.map((check) => (
                      <li key={check.id}>
                        <span style={{ color: 'var(--text-secondary)' }}>{check.name}</span>{' — '}
                        <b>{chosenLabel(check, marks.campaigns[c.id]?.[check.id]) ?? '—'}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {rubric.categories.map((cat) => (
          <section key={cat.id}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {cat.name}
            </h3>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              {cat.parameters.map((p, i) => {
                const m = marks.parameters[p.id]
                const passed = m?.result === 'pass'
                const ticks = m ? Object.entries(m.ticks) : []
                return (
                  <div key={p.id} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{passed ? p.points : 0} / {p.points}</span>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                          background: passed ? '#E5F5EC' : 'var(--alert-light)', color: passed ? 'var(--status-green)' : 'var(--alert)',
                        }}>
                          {passed ? 'Pass' : 'Fail'}
                        </span>
                      </span>
                    </div>
                    {!passed && ticks.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {ticks.map(([aid, cause]) => (
                          <li key={aid}>
                            {attrText.get(aid) ?? 'Error attribute'}
                            {cause && (
                              <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '1px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--brand-light)', color: 'var(--brand)' }}>
                                {ROOT_CAUSE_LABELS[cause as RootCause]}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!passed && m?.feedback && (
                      <p style={{ margin: '8px 0 0', padding: '8px 12px', fontSize: '12px', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
                        <b>Feedback:</b> {m.feedback}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
        Scored on {rubric.name} v{rubric.version}.
      </p>
    </div>
  )
}

// The feedback the auditor wrote for a ticked fatal error (older audits have none).
function FatalNote({ text }: { text: string | undefined }) {
  if (!text) return null
  return (
    <div style={{ marginTop: '4px', fontSize: '12px', lineHeight: 1.6, fontWeight: 400, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>
      <b>Feedback:</b> {text}
    </div>
  )
}
