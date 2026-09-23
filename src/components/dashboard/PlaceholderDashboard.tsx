'use client'

import { useAuth } from '@/hooks/useAuth'

export function PlaceholderDashboard({ title }: { title: string }) {
  const { user } = useAuth()

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
        Signed in as {user?.profile.name} ({user?.role})
      </p>
      <div style={{
        background: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '24px',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}>
        Foundation is working — auth, RBAC, and the brand theme are wired up. Later Phase 1
        steps will replace this placeholder with real content.
      </div>
    </div>
  )
}
