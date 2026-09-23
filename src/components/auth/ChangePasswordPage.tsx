'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase/client'
import { changeOwnPassword } from '@/lib/auth/password-actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/users/constants'
import { ShikhoBirdMark } from '@/components/brand/ShikhoBirdMark'

export function ChangePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    startTransition(async () => {
      const result = await changeOwnPassword(password)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Full navigation so middleware re-reads the cleared flag.
      window.location.href = '/'
    })
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: '15px', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text-primary)',
    outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px',
  }

  return (
    <div style={{
      minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', background: 'var(--surface-0)',
    }}>
      <div style={{
        width: '100%', maxWidth: '400px', background: 'var(--surface-1)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        <div style={{ textAlign: 'center', background: 'var(--brand)', padding: '28px 32px 22px' }}>
          <ShikhoBirdMark height={48} knockout />
          <p style={{
            fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase',
            letterSpacing: '0.08em', margin: '10px 0 0',
          }}>
            Set your password
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            You signed in with a temporary password. Choose your own to continue.
          </p>
          {error && (
            <div style={{
              background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)',
              padding: '10px 14px', fontSize: '14px', color: 'var(--alert)',
            }}>
              {error}
            </div>
          )}
          <div>
            <label style={labelStyle}>New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" autoFocus required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" required style={inputStyle} />
          </div>
          <button
            type="submit"
            disabled={pending || !password || !confirm}
            style={{
              padding: '12px', fontSize: '15px', fontWeight: 500, color: 'white',
              background: pending ? 'var(--border-strong)' : 'var(--brand)', border: 'none',
              borderRadius: 'var(--radius-sm)', cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? 'Saving...' : 'Save password'}
          </button>
          <button type="button" onClick={handleSignOut} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer',
          }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
