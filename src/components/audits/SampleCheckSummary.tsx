// ============================================================
// SHIKHO QA SYSTEM — Sample Check result, read-only (Phase 3, §4/§5)
// No score to show — a Sample Check is never scored. Mirrors
// ScorecardSummary's Special Check section exactly, since that's all a
// Sample Check's result IS.
// ============================================================

import { chosenLabel, type SpecialCampaign } from '@/lib/campaigns/special'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { marksFromSampleCheckPayload } from '@/lib/audits/sample-check'
import type { SampleCheckPayload } from '@/lib/audits/sample-check'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}

export function SampleCheckSummary({
  special,
  saved,
  submittedAt,
}: {
  special: SpecialCampaign[]
  saved: SampleCheckPayload
  submittedAt: string | null
}) {
  const marks = marksFromSampleCheckPayload(saved)

  return (
    <div>
      <section style={{ ...card, marginBottom: '16px', borderColor: 'var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '13px', fontWeight: 700, padding: '5px 14px', borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-1)', color: 'var(--text-secondary)',
          }}>
            SPECIAL CHECK — no score
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {submittedAt && `Logged ${formatDhakaDateTime(submittedAt)}`}
          </span>
        </div>
      </section>

      <section style={{ ...card, marginBottom: '18px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Overall feedback
        </h3>
        {marks.overallFeedback.trim() ? (
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--text-primary)' }}>{marks.overallFeedback}</p>
        ) : (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>No overall feedback was written for this check.</p>
        )}
      </section>

      <section style={{ ...card, marginBottom: '18px' }} aria-label="Special Check">
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Special Check
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-muted)' }}>What this Special Check actually checked.</p>
        {special.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>No Special Checks were recorded on this check.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {special.map((c) => (
              <div key={c.id}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {c.name}
                  {c.archived && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-muted)' }}>Archived</span>}
                </div>
                {c.checks.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>No answers were recorded for this Special Check.</div>
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
        )}
      </section>
    </div>
  )
}
