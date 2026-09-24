'use client'

import { useEffect } from 'react'

// Catches an unexpected failure while rendering a page, so the person gets
// a way to retry or leave instead of Next's bare default. The message is
// NOT shown (it can carry internal detail); the digest lets us find it in the
// server logs.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{
        maxWidth: '440px', width: '100%', textAlign: 'center', background: 'var(--paper)',
        borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          This page couldn&apos;t be loaded. Try again, or go back to your dashboard.
          {error.digest && <span style={{ display: 'block', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>Reference: {error.digest}</span>}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={reset}
            style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'white', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          >
            Try again
          </button>
          {/* A plain link (full page load) so a broken page state can't carry over. */}
          <a
            href="/dashboard"
            style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 500, color: 'var(--brand)', background: 'var(--brand-light)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  )
}
