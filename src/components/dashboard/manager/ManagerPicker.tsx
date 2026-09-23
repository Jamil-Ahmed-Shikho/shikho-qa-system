'use client'

import { useRouter } from 'next/navigation'

// Admins (super_admin / qa_manager) can view any manager's chain.
export function ManagerPicker({
  options,
  selectedId,
  period,
}: {
  options: { id: string; name: string; role: string }[]
  selectedId: string
  period: string
}) {
  const router = useRouter()
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
      Viewing
      <select
        value={selectedId}
        onChange={(e) => router.push(`/dashboard/manager?manager=${e.target.value}&period=${period}`)}
        style={{
          padding: '8px 12px', fontSize: '13px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-2)', color: 'var(--text-primary)', minWidth: '220px',
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}{o.role === 'qa_manager' ? ' (QA Manager)' : ''}</option>
        ))}
      </select>
    </label>
  )
}
