'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TEAM_NAMES } from '@/types/database.types'
import type { UserProfile, UserRole } from '@/types/database.types'
import { canManageRole, EMPLOYMENT_STAGES, SITE_NAMES, USER_ROLES } from '@/lib/users/constants'
import { activateUserAction, activateUsersAction, setUserActiveAction } from '@/lib/users/actions'
import { orgSyncByUser } from '@/lib/crm/org-compare'
import { BulkImportPanel } from './BulkImportPanel'
import { UserFormModal, type Notice } from './UserFormModal'
import { dangerBtn, disabledStyle, ghostBtn, inputStyle, primaryBtn } from './styles'

const ROLE_LABEL = Object.fromEntries(USER_ROLES.map((r) => [r.value, r.label]))
const STAGE_LABEL = Object.fromEntries(EMPLOYMENT_STAGES.map((s) => [s.value, s.label]))

export function UsersAdminClient({
  users,
  currentUserId,
  currentRole,
}: {
  users: UserProfile[]
  currentUserId: string
  currentRole: UserRole
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [team, setTeam] = useState('')
  const [site, setSite] = useState('')
  const [stage, setStage] = useState('')
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [accountFilter, setAccountFilter] = useState<'all' | 'profile_only' | 'active'>('all')
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; user: UserProfile | null } | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activating, setActivating] = useState(false)

  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const [onlyMissingTL, setOnlyMissingTL] = useState(false)
  const [onlyOutOfSync, setOnlyOutOfSync] = useState(false)
  // Where our org data disagrees with the CRM's reporting line (only for
  // people the CRM has been asked about — see schema_010).
  const orgInfo = useMemo(() => orgSyncByUser(users), [users])
  const outOfSyncCount = useMemo(() => [...orgInfo.values()].filter((i) => i.status === 'mismatch').length, [orgInfo])
  const hasNoTeamLeader = (u: UserProfile) => u.role === 'agent' && u.is_active && !u.team_leader_id
  const missingTeamLeader = useMemo(() => users.filter(hasNoTeamLeader), [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (q && !`${u.name} ${u.email} ${u.emp_id ?? ''}`.toLowerCase().includes(q)) return false
      if (role && u.role !== role) return false
      if (team && u.team_name !== team) return false
      if (site && u.site_name !== site) return false
      if (stage && u.employment_stage !== stage) return false
      if (activeFilter === 'active' && !u.is_active) return false
      if (activeFilter === 'inactive' && u.is_active) return false
      if (accountFilter !== 'all' && u.account_status !== accountFilter) return false
      if (onlyMissingTL && !hasNoTeamLeader(u)) return false
      if (onlyOutOfSync && orgInfo.get(u.id)?.status !== 'mismatch') return false
      return true
    })
  }, [users, search, role, team, site, stage, activeFilter, accountFilter, onlyMissingTL, onlyOutOfSync, orgInfo])

  const selectableIds = useMemo(() => filtered.filter((u) => u.account_status === 'profile_only').map((u) => u.id), [filtered])
  const allSelectableChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((s) => {
      if (allSelectableChecked) {
        const next = new Set(s)
        selectableIds.forEach((id) => next.delete(id))
        return next
      }
      return new Set([...s, ...selectableIds])
    })
  }

  function activateOne(u: UserProfile) {
    if (!confirm(`Activate ${u.name}? This creates a real login and emails them a temporary password now.`)) return
    startTransition(async () => {
      const res = await activateUserAction(u.id)
      if (!res.ok) return setNotice({ type: 'err', text: res.error })
      setNotice(res.emailSent
        ? { type: 'ok', text: `${u.name} activated — welcome email sent to ${u.email}.` }
        : { type: 'warn', text: `${u.name} was activated, but the welcome email could not be sent. Give them this temporary password yourself (shown once):`, secret: res.tempPassword ?? undefined })
      router.refresh()
    })
  }

  function activateSelected() {
    const ids = [...selected].filter((id) => selectableIds.includes(id))
    if (ids.length === 0) return
    if (!confirm(`Activate ${ids.length} user${ids.length === 1 ? '' : 's'}? This creates real logins and emails each a temporary password now.`)) return
    setActivating(true)
    startTransition(async () => {
      const res = await activateUsersAction(ids)
      setActivating(false)
      if (!res.ok) return setNotice({ type: 'err', text: res.error })
      const ok = res.results.filter((r) => r.status === 'activated').length
      const failed = res.results.filter((r) => r.status === 'failed').length
      const emailFailed = res.results.filter((r) => r.status === 'activated' && r.emailSent === false).length
      setNotice({
        type: failed > 0 ? 'warn' : 'ok',
        text: `${ok} activated${emailFailed > 0 ? ` (${emailFailed} welcome email(s) could not be sent — use Reset password once email is working)` : ''}${failed > 0 ? `, ${failed} failed` : ''}.`,
      })
      setSelected(new Set())
      router.refresh()
    })
  }

  function toggleActive(u: UserProfile) {
    const next = !u.is_active
    if (!next && !confirm(`Deactivate ${u.name}? They will be signed out and unable to log in.`)) return
    startTransition(async () => {
      const res = await setUserActiveAction(u.id, next)
      setNotice(res.ok
        ? { type: 'ok', text: `${u.name} ${next ? 'reactivated' : 'deactivated'}.` }
        : { type: 'err', text: res.error })
      if (res.ok) router.refresh()
    })
  }

  function handleDone(n: Notice) {
    setModal(null)
    setNotice(n)
    router.refresh()
  }

  const noticeColors = {
    ok: { bg: '#E5F5EC', border: 'var(--status-green)' },
    warn: { bg: 'var(--highlight-light)', border: 'var(--highlight)' },
    err: { bg: 'var(--alert-light)', border: 'var(--alert)' },
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Users</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Agents, team leads, auditors and managers — {users.length} total.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={ghostBtn} onClick={() => setShowBulk((v) => !v)}>Bulk import</button>
          <button style={primaryBtn} onClick={() => setModal({ mode: 'create', user: null })}>+ Add user</button>
        </div>
      </div>

      {notice && (
        <div style={{
          background: noticeColors[notice.type].bg, border: `1px solid ${noticeColors[notice.type].border}`,
          borderRadius: 'var(--radius-sm)', padding: '12px 14px', fontSize: '13px', marginBottom: '16px',
          display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start',
        }}>
          <div>
            {notice.text}
            {notice.secret && (
              <div style={{
                marginTop: '8px', fontFamily: 'Consolas, Menlo, monospace', fontSize: '15px', fontWeight: 700,
                letterSpacing: '0.04em', userSelect: 'all',
              }}>
                {notice.secret}
              </div>
            )}
          </div>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-muted)' }}>×</button>
        </div>
      )}

      {showBulk && <BulkImportPanel onClose={() => setShowBulk(false)} />}

      {missingTeamLeader.length > 0 && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)',
          padding: '12px 14px', fontSize: '13px', marginBottom: '16px',
          display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span>
            <b>{missingTeamLeader.length} active agent{missingTeamLeader.length === 1 ? ' has' : 's have'} no Team Leader.</b>{' '}
            Every agent must report to a Team Leader; until they are assigned one they can&apos;t be edited or reactivated,
            and they don&apos;t appear on any Team Lead&apos;s or Manager&apos;s dashboard.
          </span>
          <button style={ghostBtn} onClick={() => setOnlyMissingTL((v) => !v)}>
            {onlyMissingTL ? 'Show everyone' : 'Show them'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <input style={inputStyle} placeholder="Search name, email, emp ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {USER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select style={inputStyle} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {TEAM_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={inputStyle} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {SITE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>
          {EMPLOYMENT_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select style={inputStyle} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
          <option value="active">Active accounts</option>
          <option value="inactive">Deactivated</option>
          <option value="all">All accounts</option>
        </select>
        <select style={inputStyle} value={accountFilter} onChange={(e) => setAccountFilter(e.target.value as typeof accountFilter)}>
          <option value="all">Profile + login, any</option>
          <option value="profile_only">Profile only (no login)</option>
          <option value="active">Has a login</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div style={{
          background: 'var(--highlight-light)', border: '1px solid var(--highlight)', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px', fontSize: '13px', marginBottom: '12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        }}>
          <span><b>{selected.size}</b> selected</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={ghostBtn} onClick={() => setSelected(new Set())} disabled={activating}>Clear</button>
            <button style={primaryBtn} onClick={activateSelected} disabled={activating}>
              {activating ? 'Activating…' : 'Activate & send invite'}
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span>Showing {filtered.length} of {users.length}</span>
        {outOfSyncCount > 0 && (
          <button
            style={{ ...ghostBtn, background: onlyOutOfSync ? 'var(--highlight)' : 'var(--highlight-light)', color: onlyOutOfSync ? 'white' : 'var(--text-primary)' }}
            onClick={() => setOnlyOutOfSync((v) => !v)}
            title="People whose Team Leader / Manager differs from what the CRM says (checked when they come up on the call list)"
          >
            {onlyOutOfSync ? 'Show everyone' : `Out of sync with CRM (${outOfSyncCount})`}
          </button>
        )}
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '860px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', width: '32px' }}>
                {selectableIds.length > 0 && (
                  <input type="checkbox" checked={allSelectableChecked} onChange={toggleSelectAll} title="Select all profile-only rows shown" />
                )}
              </th>
              {['Name', 'Role', 'Team / Site', 'Stage', 'Team Leader', 'Status', ''].map((h) => (
                <th key={h} style={{ padding: '10px 12px', fontWeight: 600, fontSize: '12px', color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No users match these filters.
              </td></tr>
            )}
            {filtered.map((u) => {
              const manageable = canManageRole(currentRole, u.role)
              const isSelf = u.id === currentUserId
              const profileOnly = u.account_status === 'profile_only'
              return (
                <tr key={u.id} style={{ borderTop: '1px solid var(--border)', opacity: u.is_active ? 1 : 0.6 }}>
                  <td style={{ padding: '10px 12px' }}>
                    {profileOnly && (
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelected(u.id)} />
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600 }}>{u.name}{isSelf && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (you)</span>}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{u.email}{u.emp_id ? ` · ${u.emp_id}` : ''}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td style={{ padding: '10px 12px' }}>{[u.team_name, u.site_name].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{STAGE_LABEL[u.employment_stage] ?? u.employment_stage}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {hasNoTeamLeader(u)
                      ? <span style={{ color: 'var(--alert)', fontWeight: 600 }}>Missing</span>
                      : u.team_leader_id ? nameById.get(u.team_leader_id) ?? '—' : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                      background: u.is_active ? '#E5F5EC' : 'var(--surface-1)',
                      color: u.is_active ? 'var(--status-green)' : 'var(--text-muted)',
                    }}>
                      {u.is_active ? 'Active' : 'Deactivated'}
                    </span>
                    {profileOnly && (
                      <div
                        title="Profile only — no login exists yet. Matching (CRM/revenue) already works; use Activate & invite to let them sign in."
                        style={{
                          marginTop: '4px', display: 'inline-block', fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)', background: 'var(--surface-1)', color: 'var(--text-secondary)',
                          border: '1px solid var(--border-strong)',
                        }}
                      >
                        Profile only
                      </div>
                    )}
                    {orgInfo.get(u.id)?.status === 'mismatch' && (
                      <div
                        title={`CRM: ${orgInfo.get(u.id)!.label} is ${orgInfo.get(u.id)!.crmName ?? 'someone else'} · ours: ${orgInfo.get(u.id)!.weHaveNone ? 'none set' : orgInfo.get(u.id)!.ourName}`}
                        style={{
                          marginTop: '4px', display: 'inline-block', fontSize: '11px', fontWeight: 600, padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)', background: 'var(--highlight-light)', color: 'var(--text-primary)',
                          border: '1px solid var(--highlight)',
                        }}
                      >
                        Out of sync with CRM
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      style={{ ...ghostBtn, marginRight: '6px', ...(manageable ? {} : disabledStyle) }}
                      disabled={!manageable}
                      title={manageable ? undefined : 'Only a Super Admin can edit this account'}
                      onClick={() => setModal({ mode: 'edit', user: u })}
                    >
                      Edit
                    </button>
                    {profileOnly && (
                      <button
                        style={{ ...primaryBtn, marginRight: '6px', ...(!manageable || pending ? disabledStyle : {}) }}
                        disabled={!manageable || pending}
                        title={manageable ? undefined : 'Only a Super Admin can activate this account'}
                        onClick={() => activateOne(u)}
                      >
                        Activate & invite
                      </button>
                    )}
                    <button
                      style={{ ...(u.is_active ? dangerBtn : ghostBtn), ...(!manageable || isSelf || pending ? disabledStyle : {}) }}
                      disabled={!manageable || isSelf || pending}
                      title={isSelf ? "You can't deactivate your own account" : manageable ? undefined : 'Only a Super Admin can change this account'}
                      onClick={() => toggleActive(u)}
                    >
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <UserFormModal
          mode={modal.mode}
          user={modal.user}
          users={users}
          orgInfo={modal.user ? orgInfo.get(modal.user.id) ?? null : null}
          currentUserId={currentUserId}
          currentRole={currentRole}
          onClose={() => setModal(null)}
          onDone={handleDone}
        />
      )}
    </div>
  )
}
