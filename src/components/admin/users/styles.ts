import type { CSSProperties } from 'react'

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '14px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  marginBottom: '5px',
}

export const primaryBtn: CSSProperties = {
  padding: '9px 18px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'white',
  background: 'var(--brand)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

export const ghostBtn: CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--brand)',
  background: 'var(--brand-light)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

export const dangerBtn: CSSProperties = {
  ...ghostBtn,
  color: 'var(--alert)',
  background: 'var(--alert-light)',
}

export const disabledStyle: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' }
