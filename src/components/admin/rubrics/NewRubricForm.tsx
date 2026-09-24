'use client'

import { useState, useTransition } from 'react'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { useRouter } from 'next/navigation'
import { createRubric } from '@/lib/rubrics/actions'

export function NewRubricForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [totalPoints, setTotalPoints] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  useUnsavedGuard(name.trim() !== '' || totalPoints !== 100)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const id = await createRubric({ name, total_points: totalPoints })
        router.push(`/admin/rubrics/${id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create rubric.')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        maxWidth: '480px',
        background: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
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
        <label style={labelStyle}>Rubric name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Telesales Scorecard"
          required
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Total points</label>
        <input
          type="number"
          value={totalPoints}
          onChange={(e) => setTotalPoints(Number(e.target.value))}
          min={1}
          required
          style={inputStyle}
        />
      </div>

      <button
        type="submit"
        disabled={pending || !name}
        style={{
          padding: '11px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'white',
          background: pending ? 'var(--border-strong)' : 'var(--brand)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: pending ? 'not-allowed' : 'pointer',
        }}
      >
        {pending ? 'Creating...' : 'Create rubric'}
      </button>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
        You&apos;ll add categories, parameters, error attributes, and fatal items on the next screen.
      </p>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box',
}
