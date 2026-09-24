import Link from 'next/link'

// Shown for any unknown URL and for notFound() (e.g. a deleted campaign or
// rubric link). Without this, Next's bare default page has no way back.
export default function NotFound() {
  return (
    <main style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{
        maxWidth: '440px', width: '100%', textAlign: 'center', background: 'var(--paper)',
        borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>404</div>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '6px 0 8px' }}>Page not found</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          This page doesn&apos;t exist, or it may have been removed or you may not have access to it.
        </p>
        <Link
          href="/dashboard"
          style={{ display: 'inline-block', padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'white', background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}
        >
          Go to your dashboard
        </Link>
      </div>
    </main>
  )
}
