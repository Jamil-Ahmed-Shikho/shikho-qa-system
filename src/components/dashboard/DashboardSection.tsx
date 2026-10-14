// ============================================================
// SHIKHO QA SYSTEM — a labeled group of dashboard cards (icon + title +
// optional description, then a flex-wrap row of children). Every dashboard
// page previously repeated the same bare flex-wrap grid with no heading —
// this replaces that for the Admin Dashboard's categorized nav-card
// sections (Action Needed / Monitoring & Oversight / Reports, Analysis &
// TNI / Maintenance & Configuration). Generic enough for other dashboards
// to adopt later.
// ============================================================

export function DashboardSection({
  title,
  icon,
  description,
  muted,
  children,
}: {
  title: string
  icon?: string
  description?: string
  /** Visually de-emphasized heading — used for the rarely-touched Maintenance & Configuration group. */
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        {icon && (
          <i
            className={`ti ${icon}`}
            aria-hidden
            style={{ fontSize: '17px', color: muted ? 'var(--text-muted)' : 'var(--brand)' }}
          />
        )}
        <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: muted ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
          {title}
        </h2>
      </div>
      {description && (
        <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 12px' }}>{description}</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: description ? 0 : '10px' }}>
        {children}
      </div>
    </section>
  )
}
