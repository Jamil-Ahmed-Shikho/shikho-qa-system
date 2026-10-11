// ============================================================
// SHIKHO QA SYSTEM — a small tinted pill chip for a status/priority label
// (e.g. "Critical fatal error", "On a PIP"), replacing plain colored text.
// Uses the system's existing *-light background tokens (src/app/layout.tsx)
// rather than inventing new colors — built for the Team Lead dashboard
// standardization (2026-10-12) but generic, so any screen can use it.
// ============================================================

export type ChipTone = 'alert' | 'warning' | 'success' | 'neutral'

const TONE_STYLE: Record<ChipTone, { bg: string; fg: string }> = {
  alert: { bg: 'var(--alert-light)', fg: 'var(--alert)' },
  warning: { bg: 'var(--highlight-light)', fg: 'var(--highlight)' },
  success: { bg: 'var(--status-green-light)', fg: 'var(--status-green)' },
  neutral: { bg: 'var(--surface-1)', fg: 'var(--text-secondary)' },
}

export function StatusChip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  const s = TONE_STYLE[tone]
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px',
        borderRadius: 'var(--radius-pill)', fontSize: '11px', fontWeight: 700, lineHeight: 1.4,
        background: s.bg, color: s.fg, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
