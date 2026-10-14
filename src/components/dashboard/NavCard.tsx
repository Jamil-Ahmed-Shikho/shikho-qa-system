import Link from 'next/link'

// `icon` is optional (Tabler class suffix, e.g. "ti-users") so every existing
// call site across the app keeps compiling unchanged — added for the Admin
// Dashboard's categorized sections, 2026-10-14. `description` is also now
// optional (2026-10-14): the Admin Dashboard dropped it from every card —
// the destination page's own <h1>+subtitle already explains it, so saying
// it twice was clutter (Jamil's own feedback); every other caller that still
// passes a description keeps rendering it unchanged.
export function NavCard({ href, title, description, icon }: { href: string; title: string; description?: string; icon?: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        width: '240px',
        padding: '20px',
        background: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: description ? '6px' : 0 }}>
        {icon && <i className={`ti ${icon}`} aria-hidden style={{ fontSize: '15px', color: 'var(--brand)' }} />}
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{title}</div>
      </div>
      {description && <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{description}</div>}
    </Link>
  )
}
