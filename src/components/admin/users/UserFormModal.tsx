'use client'

import { useState, useTransition } from 'react'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { LEAVE_MESSAGE } from '@/lib/ui/unsaved'
import { TEAM_NAMES } from '@/types/database.types'
import type { UserProfile, UserRole } from '@/types/database.types'
import {
  canManageRole,
  EMPLOYMENT_STAGES,
  SITE_NAMES,
  TAG_FIELDS,
  USER_ROLES,
  type TagField,
} from '@/lib/users/constants'
import { validateTeamLeaderRequired, validateUserInput, type UserInput } from '@/lib/users/validation'
import { createUserAction, resetUserPasswordAction, updateUserAction } from '@/lib/users/actions'
import type { TagIds } from '@/lib/users/users.service'
import type { OrgSyncInfo } from '@/lib/crm/org-compare'
import { dangerBtn, ghostBtn, inputStyle, labelStyle, primaryBtn } from './styles'

export type Notice = { type: 'ok' | 'warn' | 'err'; text: string; secret?: string }

interface Props {
  mode: 'create' | 'edit'
  user: UserProfile | null
  users: UserProfile[]
  /** How this person's Team Leader / Manager compares with the CRM's, if the CRM has been asked. */
  orgInfo?: OrgSyncInfo | null
  currentUserId: string
  currentRole: UserRole
  onClose: () => void
  onDone: (notice: Notice) => void
}

export function UserFormModal({ mode, user, users, orgInfo, currentUserId, currentRole, onClose, onDone }: Props) {
  const [form, setForm] = useState<UserInput>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    emp_id: user?.emp_id ?? '',
    role: user?.role ?? 'agent',
    team_name: user?.team_name ?? '',
    site_name: user?.site_name ?? '',
    joining_date: user?.joining_date ?? '',
    employment_stage: user?.employment_stage ?? 'active',
    ojt_start_date: user?.ojt_start_date ?? '',
  })
  const [tags, setTags] = useState<Record<TagField, string>>({
    team_leader_id: user?.team_leader_id ?? '',
    manager_id: user?.manager_id ?? '',
    quality_auditor_id: user?.quality_auditor_id ?? '',
    trainer_id: user?.trainer_id ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Snapshot of the values the form opened with; anything different is unsaved work.
  const [opened] = useState(() => JSON.stringify({ form, tags }))
  const dirty = JSON.stringify({ form, tags }) !== opened
  useUnsavedGuard(dirty)
  // Closing the dialog (x, Cancel, clicking outside) discards edits, so ask first — like leaving a page.
  const requestClose = () => { if (!dirty || confirm(LEAVE_MESSAGE)) onClose() }

  const set = (key: keyof UserInput, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const isEdit = mode === 'edit'
  const stageBlocksJoining = form.employment_stage === 'ojt' || form.employment_stage === 're_training'
  const roleOptions = USER_ROLES.filter((r) => canManageRole(currentRole, r.value))

  const tagOptions = (field: TagField) =>
    users.filter(
      (u) =>
        u.is_active &&
        u.id !== user?.id &&
        (TAG_FIELDS[field].roles as UserRole[]).includes(u.role)
    )

  function tagIds(): TagIds {
    return {
      team_leader_id: tags.team_leader_id || null,
      manager_id: tags.manager_id || null,
      quality_auditor_id: tags.quality_auditor_id || null,
      trainer_id: tags.trainer_id || null,
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const check = validateUserInput(form)
    if (!check.ok) {
      setError(check.error)
      return
    }
    // A deactivated agent (a leaver) may be edited without one — same
    // carve-out as the database rule.
    if (!isEdit || user?.is_active) {
      const tlError = validateTeamLeaderRequired(check.value.role, tags.team_leader_id)
      if (tlError) {
        setError(tlError)
        return
      }
    }

    startTransition(async () => {
      if (isEdit && user) {
        const res = await updateUserAction(user.id, form, tagIds())
        if (!res.ok) return setError(res.error)
        onDone({ type: 'ok', text: `${form.name} updated.` })
      } else {
        const res = await createUserAction(form, tagIds())
        if (!res.ok) return setError(res.error)
        if (res.emailSent) {
          onDone({ type: 'ok', text: `${form.name} created — welcome email sent to ${form.email.trim().toLowerCase()}.` })
        } else {
          onDone({
            type: 'warn',
            text: `${form.name} was created, but the welcome email could not be sent. Give them this temporary password yourself (shown once):`,
            secret: res.tempPassword ?? undefined,
          })
        }
      }
    })
  }

  function handleResetPassword() {
    if (!user) return
    if (!confirm(`Reset the password for ${user.name}? They will be emailed a new temporary password and must change it at next sign-in.`)) return
    setError(null)
    startTransition(async () => {
      const res = await resetUserPasswordAction(user.id)
      if (!res.ok) return setError(res.error)
      if (res.emailSent) {
        onDone({ type: 'ok', text: `Password reset — new temporary password emailed to ${user.email}.` })
      } else {
        onDone({
          type: 'warn',
          text: `Password was reset, but the email could not be sent. Give ${user.name} this temporary password yourself (shown once):`,
          secret: res.tempPassword ?? undefined,
        })
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,19,34,0.5)', zIndex: 100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) requestClose() }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: '680px', background: 'var(--paper)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', padding: '24px', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>{isEdit ? `Edit ${user?.name}` : 'Add user'}</h2>
          <button type="button" onClick={requestClose} disabled={pending} aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}>
            ×
          </button>
        </div>

        {error && (
          <div style={{
            background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)',
            padding: '10px 14px', fontSize: '13px', color: 'var(--alert)', marginBottom: '14px',
          }}>
            {error}
          </div>
        )}

        <Section title="Identity">
          <Field label="Name *"><input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label={isEdit ? 'Email (login — cannot be changed)' : 'Email *'}>
            <input style={{ ...inputStyle, ...(isEdit ? { opacity: 0.6 } : {}) }} type="email" value={form.email}
              onChange={(e) => set('email', e.target.value)} disabled={isEdit} required />
          </Field>
          <Field label="Employee ID"><input style={inputStyle} value={form.emp_id} onChange={(e) => set('emp_id', e.target.value)} /></Field>
          <Field label="Role *">
            <select style={inputStyle} value={form.role} onChange={(e) => set('role', e.target.value)}
              disabled={isEdit && user?.id === currentUserId}>
              {/* Keep the current role visible even if the actor couldn't assign it fresh. */}
              {(roleOptions.some((r) => r.value === form.role)
                ? roleOptions
                : [...USER_ROLES.filter((r) => r.value === form.role), ...roleOptions]
              ).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Placement">
          <Field label={form.role === 'agent' || form.role === 'team_lead' ? 'Team *' : 'Team'}>
            <select style={inputStyle} value={form.team_name} onChange={(e) => set('team_name', e.target.value)}>
              <option value="">— None —</option>
              {TEAM_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label={form.role === 'agent' ? 'Site *' : 'Site'}>
            <select style={inputStyle} value={form.site_name} onChange={(e) => set('site_name', e.target.value)}>
              <option value="">— None —</option>
              {SITE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Reports to / supported by">
          {(Object.keys(TAG_FIELDS) as TagField[]).map((field) => (
            <Field
              key={field}
              label={
                field === 'team_leader_id' && form.role === 'agent' ? `${TAG_FIELDS[field].label} *`
                : field === 'manager_id' && form.role === 'agent' ? `${TAG_FIELDS[field].label} (reference only)`
                : TAG_FIELDS[field].label
              }
              // On a Team Lead, Manager is what places them in a Manager's
              // reporting chain. On an agent it's informational: visibility
              // and rollups follow the agent's Team Leader.
              hint={field === 'manager_id' && form.role === 'agent'
                ? 'Informational only — who can see this agent is decided by their Team Leader, not this.'
                : undefined}
            >
              <select style={inputStyle} value={tags[field]} onChange={(e) => setTags((t) => ({ ...t, [field]: e.target.value }))}>
                <option value="">— None —</option>
                {tagOptions(field).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </Field>
          ))}
          {isEdit && orgInfo && <CrmOrgNote info={orgInfo} />}
        </Section>

        <Section title="Employment">
          <Field label="Employment stage">
            <select
              style={inputStyle}
              value={form.employment_stage}
              onChange={(e) => {
                const stage = e.target.value
                setForm((f) => ({
                  ...f,
                  employment_stage: stage,
                  // §7: joining_date stays empty during OJT / re-training.
                  joining_date: stage === 'ojt' || stage === 're_training' ? '' : f.joining_date,
                }))
              }}
            >
              {EMPLOYMENT_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label={form.role === 'agent' && form.employment_stage === 'active' ? 'Joining date *' : 'Joining date'}>
            <input style={{ ...inputStyle, ...(stageBlocksJoining ? { opacity: 0.6 } : {}) }} type="date"
              value={form.joining_date} onChange={(e) => set('joining_date', e.target.value)} disabled={stageBlocksJoining} />
            {stageBlocksJoining && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Set when the agent is certified (leaves OJT).
              </div>
            )}
          </Field>
          <Field label="OJT start date">
            <input style={inputStyle} type="date" value={form.ojt_start_date} onChange={(e) => set('ojt_start_date', e.target.value)} />
          </Field>
        </Section>

        {!isEdit && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            A temporary password is generated and emailed to the user. They must set their own at first sign-in.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            {isEdit && (
              <button type="button" style={dangerBtn} disabled={pending} onClick={handleResetPassword}>
                Reset password
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" style={ghostBtn} onClick={requestClose} disabled={pending}>Cancel</button>
            <button type="submit" style={{ ...primaryBtn, ...(pending ? { background: 'var(--border-strong)', cursor: 'not-allowed' } : {}) }} disabled={pending}>
              {pending ? 'Saving...' : isEdit ? 'Save changes' : 'Create user'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// What the CRM says about this person's reporting line (informational —
// the CRM is not authoritative; correct our fields above if they're wrong).
function CrmOrgNote({ info }: { info: OrgSyncInfo }) {
  const when = info.checkedAt ? new Date(info.checkedAt).toLocaleDateString() : null
  const mismatch = info.status === 'mismatch'
  let text: React.ReactNode
  if (mismatch) {
    text = (
      <>
        The CRM lists <b>{info.crmName ?? 'someone else'}</b> as their {info.label}
        {info.weHaveNone ? <>; we have none set.</> : <>; we have <b>{info.ourName}</b>.</>}
      </>
    )
  } else if (info.status === 'in_sync') {
    text = <>Matches the CRM&apos;s {info.label}{info.crmName ? ` (${info.crmName})` : ''}.</>
  } else if (info.status === 'crm_has_none') {
    text = <>The CRM has no {info.label} on record for them.</>
  } else {
    text = <>The CRM lists {info.crmName ?? 'someone'} as their {info.label}, but we couldn&apos;t confirm it&apos;s the same person as ours.</>
  }
  return (
    <div style={{
      gridColumn: '1 / -1', fontSize: '12px', lineHeight: 1.6, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
      background: mismatch ? 'var(--highlight-light)' : 'var(--surface-0)',
      borderLeft: `3px solid ${mismatch ? 'var(--highlight)' : 'var(--border-strong)'}`,
      color: 'var(--text-secondary)',
    }}>
      {mismatch && <b style={{ color: 'var(--text-primary)' }}>Out of sync with CRM · </b>}
      {text}
      {when && <span style={{ color: 'var(--text-muted)' }}> Checked {when}.</span>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
      <legend style={{
        fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.05em', padding: 0, marginBottom: '8px',
      }}>
        {title}
      </legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>{children}</div>
    </fieldset>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}
