'use client'
// ============================================================
// SHIKHO QA SYSTEM — App Shell
// Top bar with brand mark, current user, sign out
// ============================================================

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { confirmLeave } from '@/lib/ui/unsaved'
import { ShikhoBirdMark } from '@/components/brand/ShikhoBirdMark'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  qa_manager: 'QA Manager',
  manager: 'Manager',
  qa_auditor: 'QA Auditor',
  team_lead: 'Team Lead',
  agent: 'Agent',
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth()

  return (
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        background: 'var(--paper)',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Home: /dashboard sends each role to its own dashboard. Asks first if a page has unsaved work. */}
        <Link
          href="/dashboard"
          aria-label="Home"
          title="Home"
          style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)' }}
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault()
          }}
        >
          <ShikhoBirdMark height={28} />
        </Link>
        {!loading && user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {user.profile.name}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {ROLE_LABELS[user.role] || user.role}
              </div>
            </div>
            <button
              onClick={() => {
                if (confirmLeave()) signOut()
              }}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--brand)',
                background: 'var(--brand-light)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main style={{ flex: 1, padding: '24px 20px' }}>{children}</main>
    </div>
  )
}
