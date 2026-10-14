import Link from 'next/link'

// `icon` is optional (Tabler class suffix, e.g. "ti-users") so every existing
// call site across the app keeps compiling unchanged — added for the Admin
// Dashboard's categorized sections, 2026-10-14.
export function NavCard({ href, title, description, icon }: { href: string; title: string; description: string; icon?: string }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '6px' }}>
        {icon && <i className={`ti ${icon}`} aria-hidden style={{ fontSize: '15px', color: 'var(--brand)' }} />}
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{description}</div>
    </Link>
  )
}
