'use client'
// ============================================================
// SHIKHO QA SYSTEM — Login Page
// Clean, branded, mobile-first
// ============================================================

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { ShikhoBirdMark } from '@/components/brand/ShikhoBirdMark'
import type { UserRole } from '@/types/database.types'

export function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    })

    if (signInError) {
      setError(
        signInError.message.includes('Invalid login')
          ? 'Invalid email or password.'
          : 'Sign in failed. Please try again.'
      )
      setLoading(false)
      return
    }

    if (!data.user) {
      setError('Unexpected error. Please try again.')
      setLoading(false)
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('name, is_active, role')
      .eq('auth_id', data.user.id)
      .single()

    if (profileError) {
      await supabase.auth.signOut()
      setError('Could not load your account. Please try again or contact your administrator.')
      setLoading(false)
      return
    }

    if (!profile) {
      await supabase.auth.signOut()
      setError('Account not found. Contact your administrator.')
      setLoading(false)
      return
    }

    if (!profile.is_active) {
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Contact your administrator.')
      setLoading(false)
      return
    }

    const destination = getRoleRedirect(profile.role as UserRole) || redirect
    router.push(destination)
    router.refresh()
  }

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      background: 'var(--surface-0)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        <div style={{ textAlign: 'center', background: 'var(--brand)', padding: '32px 32px 24px' }}>
          <ShikhoBirdMark height={56} knockout />
          <p style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '10px 0 0',
          }}>
            QA Audit Management System
          </p>
        </div>

        <div style={{ padding: '32px' }}>
          {error && (
            <div style={{
              background: 'var(--alert-light)',
              border: '1px solid var(--alert)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              marginBottom: '20px',
              fontSize: '14px',
              color: 'var(--alert)',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your.name@shikho.com"
                required
                autoComplete="email"
                autoFocus
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  <i className={showPassword ? 'ti ti-eye-off' : 'ti ti-eye'} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '15px',
                fontWeight: 500,
                color: 'white',
                background: loading ? 'var(--border-strong)' : 'var(--brand)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: '4px',
              }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: '15px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
}

function getRoleRedirect(role: UserRole | undefined): string | null {
  switch (role) {
    case 'super_admin':
    case 'qa_manager': return '/dashboard/admin'
    case 'manager':    return '/dashboard/manager'
    case 'qa_auditor': return '/dashboard/auditor'
    case 'team_lead':  return '/dashboard/team'
    case 'agent':      return '/dashboard/agent'
    default:           return null
  }
}
