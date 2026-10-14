import Link from 'next/link'

// ============================================================
// SHIKHO QA SYSTEM — a small, shared "glance" KPI tile: a value, a label,
// an optional sub-line, and a colored left-edge accent bar. Mirrors the
// private StatTile already hand-rolled inside AgentDashboardView.tsx, but
// exported so other dashboards (starting with the Admin Dashboard's live
// snapshot) don't each reimplement the same box. Accent is a named tone
// (not a raw CSS value) so every caller stays on the brand palette.
// ============================================================

export type StatTileAccent = 'brand' | 'green' | 'sunrise' | 'coral' | 'neutral'

const ACCENT_COLOR: Record<StatTileAccent, string> = {
  brand: 'var(--brand)',
  green: 'var(--status-green)',
  sunrise: 'var(--highlight)',
  coral: 'var(--alert)',
  neutral: 'var(--border-strong)',
}

export function StatTile({
  label,
  value,
  sub,
  accent = 'neutral',
  href,
  small,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: StatTileAccent
  href?: string
  small?: boolean
}) {
  const body = (
    <div
      style={{
        background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: small ? '14px 16px' : '16px 18px', position: 'relative', overflow: 'hidden', height: '100%',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: ACCENT_COLOR[accent] }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: small ? '20px' : '26px', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: sub ? '2px' : 0, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )

  if (!href) return body
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      {body}
    </Link>
  )
}
