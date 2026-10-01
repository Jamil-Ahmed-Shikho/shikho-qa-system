'use client'
// ============================================================
// SHIKHO QA SYSTEM — App Shell
// Top bar with brand mark, a user avatar menu (name/email/role, change
// password, sign out) — matches the CMS's own avatar-menu pattern, per
// Jamil's reference screenshot (2026-10-02).
// ============================================================

import { useEffect, useRef, useState } from 'react'
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function UserMenu({ name, email, role, onSignOut }: { name: string; email: string; role: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        style={{
          width: '38px', height: '38px', borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: 'white', fontSize: '14px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {initialsOf(name)}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 50,
            width: '260px', background: 'var(--paper)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(15,19,34,0.14)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 18px 14px' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{name}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{email}</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--brand)', marginTop: '4px' }}>{role}</div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <Link
              href="/auth/change-password"
              role="menuitem"
              onClick={(e) => {
                if (!confirmLeave()) { e.preventDefault(); return }
                setOpen(false)
              }}
              style={{
                display: 'block', padding: '12px 18px', fontSize: '14px', fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            >
              Change password
            </Link>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (confirmLeave()) onSignOut()
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 18px', fontSize: '14px', fontWeight: 500,
                color: 'var(--alert)', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault()
          }}
        >
          <ShikhoBirdMark height={44} />
          <span className="shikho-portal-subtitle" aria-hidden style={{ width: '1px', height: '28px', background: 'var(--border-strong)' }} />
          <span
            className="shikho-portal-subtitle"
            style={{ fontSize: '18px', lineHeight: 1, fontWeight: 700, color: 'var(--brand)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}
          >
            Audit Management System
          </span>
        </Link>
        <style>{`@media (max-width: 480px) { .shikho-portal-subtitle { display: none; } }`}</style>
        {!loading && user && (
          <UserMenu
            name={user.profile.name}
            email={user.profile.email}
            role={ROLE_LABELS[user.role] || user.role}
            onSignOut={signOut}
          />
        )}
      </header>
      <main style={{ flex: 1, padding: '24px 20px' }}>{children}</main>
    </div>
  )
}
