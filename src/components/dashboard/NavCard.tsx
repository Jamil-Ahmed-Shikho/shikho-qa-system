import Link from 'next/link'

export function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
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
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{description}</div>
    </Link>
  )
}
