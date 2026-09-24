// ============================================================
// Call status presentation (§10). Brand palette only — no new colours:
//   Answer     -> Primary Indigo (--brand)
//   No Answer  -> Alert Coral    (--alert)
// Anything else the CRM might send shows neutrally rather than borrowing
// a colour that would imply a meaning we haven't been given.
// ============================================================

export interface CallStatusPresentation {
  label: string
  bg: string
  color: string
}

export function callStatusPresentation(raw: string | null | undefined): CallStatusPresentation {
  const key = (raw ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '')
  if (key === 'ANSWER') return { label: 'Answer', bg: 'var(--brand-light)', color: 'var(--brand)' }
  if (key === 'NOANSWER') return { label: 'No Answer', bg: 'var(--alert-light)', color: 'var(--alert)' }
  const label = (raw ?? '').trim()
  return { label: label || 'Unknown', bg: 'var(--surface-1)', color: 'var(--text-muted)' }
}
