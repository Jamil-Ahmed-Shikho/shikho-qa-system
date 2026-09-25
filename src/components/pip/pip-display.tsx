// Shared display bits for the PIP screens (server-safe: no state, no hooks).

import type { PipStatus, PipUnit } from '@/lib/pip/pip.service'

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** 'YYYY-MM-DD' (a calendar date, no time zone) -> "12 Sep 2026". */
export function fmtDate(d: string | null): string {
  if (!d) return '—'
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(t.getTime()) ? '—' : dateFmt.format(t)
}
export function fmtMonth(d: string): string {
  return monthFmt.format(new Date(`${d.slice(0, 10)}T00:00:00Z`))
}

export function fmtMoney(v: number | null, unit: PipUnit | null): string {
  if (v === null) return '—'
  if (unit === 'USD') return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `৳ ${Math.round(v).toLocaleString('en-BD')}`
}

const TONE: Record<PipStatus, { label: string; color: string }> = {
  suggested: { label: 'Suggested', color: 'var(--highlight)' },
  excluded: { label: 'Excluded', color: 'var(--text-muted)' },
  approved: { label: 'On PIP', color: 'var(--brand)' },
  completed: { label: 'Completed', color: 'var(--status-green)' },
  failed: { label: 'Failed', color: 'var(--alert)' },
}

export function StatusBadge({ status }: { status: PipStatus }) {
  const t = TONE[status]
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      borderStyle: 'solid', borderWidth: '1px', borderColor: t.color, color: t.color,
    }}>{t.label}</span>
  )
}

export const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px 20px',
}
export const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
export const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
