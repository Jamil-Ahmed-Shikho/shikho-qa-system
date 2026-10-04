'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { parseLeadIdentifier } from '@/lib/crm/lead-id-parser'

export function LeadLookupForm() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The lead page takes a moment to render (CRM + database). Without this the
  // button just sat there after a click; now it says it's working.
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const leadId = parseLeadIdentifier(value)
    if (!leadId) {
      setError('Could not find a lead ID in that — paste a lead ID (e.g. 12345) or a lead URL (e.g. crm.shikho.com/details/lead/12345).')
      return
    }
    setError(null)
    startTransition(() => router.push(`/audits/leads/${leadId}`))
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        maxWidth: '520px',
      }}
    >
      {error && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '14px', color: 'var(--alert)',
        }}>
          {error}
        </div>
      )}
      <div>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
          Lead ID or lead URL
        </label>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          placeholder="12345 or crm.shikho.com/details/lead/12345"
          autoFocus
          style={{
            width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text-primary)',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>
      <button
        type="submit"
        disabled={!value.trim() || pending}
        aria-busy={pending}
        style={{
          alignSelf: 'flex-start', padding: '10px 20px', fontSize: '14px', fontWeight: 500,
          color: 'white', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)',
          cursor: pending ? 'progress' : !value.trim() ? 'not-allowed' : 'pointer',
          opacity: !value.trim() && !pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Looking up calls…' : 'Find calls'}
      </button>
    </form>
  )
}
