'use client'
// ============================================================
// SHIKHO QA SYSTEM — Forgot password (2026-11-05, Jamil: a link on the login page, same as the
// Complaint Management System's). Same shell/branding as LoginPage.tsx. Always shows the same
// generic confirmation after submit, whatever actually happened server-side (requestPasswordResetAction
// never reveals which emails are registered) — so this page's own copy must not imply otherwise.
// ============================================================

import { useState, type FormEvent } from 'react'
import { ShikhoBirdMark } from '@/components/brand/ShikhoBirdMark'
import { requestPasswordResetAction } from '@/lib/auth/password-actions'
import { BackLink } from '@/components/common/BackLink'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    await requestPasswordResetAction(email)
    setLoading(false)
    setSubmitted(true)
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
            fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.85)',
            textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 0 0',
          }}>
            QA Audit Management System
          </p>
        </div>

        <div style={{ padding: '32px' }}>
          {submitted ? (
            <div>
              <h1 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 10px', color: 'var(--text-primary)' }}>Check your email</h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px' }}>
                If an account exists for <b>{email}</b>, we&apos;ve sent new sign-in details to it. The link in that email has no further
                step — sign in with the new temporary password, and you&apos;ll be asked to choose your own.
              </p>
              <BackLink href="/auth/login" label="Back to sign in" />
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 6px', color: 'var(--text-primary)' }}>Forgot your password?</h1>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
                Enter your account email and we&apos;ll send new sign-in details, if an account exists for it.
              </p>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.name@shikho.com"
                    required
                    autoComplete="email"
                    autoFocus
                    style={inputStyle}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  style={{
                    width: '100%', padding: '12px', fontSize: '15px', fontWeight: 500, color: 'white',
                    background: loading ? 'var(--border-strong)' : 'var(--brand)', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '4px',
                  }}
                >
                  {loading ? 'Sending…' : 'Send new sign-in details'}
                </button>
              </form>
              <div style={{ textAlign: 'center', marginTop: '18px' }}>
                <BackLink href="/auth/login" label="Back to sign in" />
              </div>
            </>
          )}
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
