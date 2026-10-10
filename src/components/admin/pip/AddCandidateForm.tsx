'use client'
// Jamil, 2026-10-10: "admin and QA manager should have agent add option manually in pip list." A
// third way onto the cycle's list, besides generate_pip_candidates() (the benchmark/vintage run)
// and a Manager's accepted include request — a direct, unilateral add, pre-publish only.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCandidateAction, searchAgentsAction } from '@/lib/pip/actions'
import type { PipAgentOption } from '@/lib/pip/pip.service'
import { ghostBtn, inputStyle, disabledStyle } from '@/components/admin/users/styles'

export function AddCandidateForm({ cycleId }: { cycleId: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PipAgentOption[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const res = await searchAgentsAction(q)
      setSearching(false)
      if (res.ok) setResults(res.results)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  function add(agent: PipAgentOption) {
    setError(null)
    setAdded(null)
    setBusyId(agent.id)
    ;(async () => {
      const res = await addCandidateAction(cycleId, agent.id)
      setBusyId(null)
      if (!res.ok) return setError(res.error)
      setAdded(agent.name)
      setQuery('')
      setResults([])
      router.refresh()
    })()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '420px' }}>
      <input
        style={inputStyle}
        placeholder="Search an agent by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search an agent to add"
      />
      {searching && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Searching…</div>}
      {results.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {results.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || r.email}</div>
              </div>
              <button
                style={{ ...ghostBtn, ...(busyId === r.id ? disabledStyle : {}) }}
                disabled={busyId !== null}
                onClick={() => add(r)}
              >
                {busyId === r.id ? 'Adding…' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No active agent matches &quot;{query.trim()}&quot;.</div>
      )}
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)' }}>{error}</div>}
      {added && <div style={{ fontSize: '12px', color: 'var(--status-green)' }}>{added} added as suggested.</div>}
    </div>
  )
}
