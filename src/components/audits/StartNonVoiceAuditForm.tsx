'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startNonVoiceAudit } from '@/lib/audits/actions'

interface AgentOption {
  id: string
  name: string
  email: string
  team_name: string | null
}

const fieldLabel: React.CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box',
}

export function StartNonVoiceAuditForm({ agents }: { agents: AgentOption[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AgentOption | null>(null)
  const [auditType, setAuditType] = useState<'chat' | 'complaint'>('chat')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return agents
      .filter((a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || (a.team_name ?? '').toLowerCase().includes(q))
      .slice(0, 20)
  }, [query, agents])

  function pick(agent: AgentOption) {
    setSelected(agent)
    setQuery('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) { setError('Pick the agent first.'); return }
    if (!reference.trim()) { setError('Paste the ticket link or ID first.'); return }
    setError(null)
    startTransition(async () => {
      try {
        const auditId = await startNonVoiceAudit(selected.id, reference, auditType)
        router.push(`/audits/${auditId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the audit.')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '520px',
      }}
    >
      {error && (
        <div style={{ background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '14px', color: 'var(--alert)' }}>
          {error}
        </div>
      )}

      <div>
        <label style={fieldLabel}>Agent</label>
        {selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--brand-light)' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{selected.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{selected.email}{selected.team_name ? ` · ${selected.team_name}` : ''}</div>
            </div>
            <button type="button" onClick={() => setSelected(null)} disabled={pending}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={pending}
              placeholder="Search by name, email or team…"
              autoFocus
              style={inputStyle}
            />
            {matches.length > 0 && (
              <div style={{ marginTop: '6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', maxHeight: '220px', overflowY: 'auto' }}>
                {matches.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => pick(a)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: '13.5px',
                      background: 'var(--paper)', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{a.name}</span>{' '}
                    <span style={{ color: 'var(--text-muted)' }}>{a.email}{a.team_name ? ` · ${a.team_name}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div>
        <label style={fieldLabel}>Type</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['chat', 'complaint'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAuditType(t)}
              disabled={pending}
              style={{
                flex: 1, padding: '8px 10px', fontSize: '13px', fontWeight: 600, borderRadius: 'var(--radius-md)',
                cursor: 'pointer', border: auditType === t ? '2px solid var(--brand)' : '1px solid var(--border)',
                color: auditType === t ? 'var(--brand)' : 'var(--text-muted)',
                background: auditType === t ? 'var(--brand-light)' : 'var(--surface)',
              }}
            >
              {t === 'chat' ? 'Chat' : 'Complaint'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={fieldLabel}>Ticket / chat reference</label>
        <textarea
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          disabled={pending}
          placeholder="Paste the Userevora ticket link or ID"
          maxLength={500}
          style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <button
        type="submit"
        disabled={!selected || !reference.trim() || pending}
        aria-busy={pending}
        style={{
          alignSelf: 'flex-start', padding: '10px 20px', fontSize: '14px', fontWeight: 500,
          color: 'white', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)',
          cursor: pending ? 'progress' : !selected || !reference.trim() ? 'not-allowed' : 'pointer',
          opacity: (!selected || !reference.trim()) && !pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Starting…' : 'Start audit'}
      </button>
    </form>
  )
}
