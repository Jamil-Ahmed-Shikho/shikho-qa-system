'use client'
// The campaign editor: header actions, details, and the checks with their
// closed lists of options. Every change is a server action; on success the
// page re-reads (router.refresh) so what's shown is always what's stored.
//
// The rules that protect past audits live in the database. This screen just
// shows them plainly: the text of a check or option used in a submitted audit is
// locked (with the reason), and anything any audit has used can only be archived.
// Separately, removing something that would stop a working campaign being offered
// (an option that takes a check below 2 active options, or the last active check)
// is allowed but asks for confirmation first — it warns, it never blocks.

import { useState } from 'react'
import { useUnsavedGuard } from '@/lib/ui/use-unsaved'
import { BackLink } from '@/components/common/BackLink'
import { useRouter } from 'next/navigation'
import {
  createCheckTypeAction,
  createOptionAction,
  deleteCampaignAction,
  deleteCheckTypeAction,
  deleteOptionAction,
  reorderCheckTypesAction,
  reorderOptionsAction,
  setCampaignArchivedAction,
  setCheckTypeArchivedAction,
  setOptionArchivedAction,
  setOptionMistakeAction,
  updateCheckTypeAction,
  updateOptionAction,
} from '@/lib/campaigns/actions'
import {
  CAMPAIGN_LIMITS,
  OPTION_LIMITS,
  activeOptions,
  campaignReadiness,
  checkRemovalWarning,
  moveWithin,
  optionRemovalWarning,
  scopeLabel,
  type CampaignTree,
  type CampaignTreeCheck,
} from '@/lib/campaigns/rules'
import type { CampaignUsage, Usage } from '@/lib/campaigns/campaigns.service'
import type { CampaignCheckValue } from '@/types/database.types'
import { CampaignForm } from './CampaignForm'
import { dangerBtn, disabledStyle, ghostBtn, inputStyle, primaryBtn } from '@/components/admin/users/styles'

const NO_USE: Usage = { submitted: 0, draft: 0 }
const isUsed = (u: Usage) => u.submitted + u.draft > 0

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}

export function CampaignEditor({ tree, usage }: { tree: CampaignTree; usage: CampaignUsage }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const readiness = campaignReadiness(tree)
  const campaignUsed = isUsed(usage.campaign)
  const archivedChecks = tree.checkTypes.filter((c) => c.is_archived).length

  /** Run an action; on success re-read the page, on failure say why. Resolves true on success. */
  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> {
    setBusy(true)
    setError(null)
    const res = await action()
    setBusy(false)
    if (!res.ok) { setError(res.error); return false }
    router.refresh()
    return true
  }

  async function deleteCampaign() {
    if (!confirm(`Delete "${tree.name}" and all of its checks and options? This can't be undone.`)) return
    setBusy(true); setError(null)
    const res = await deleteCampaignAction(tree.id)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.push('/admin/campaigns')
  }

  const visibleChecks = tree.checkTypes.filter((c) => showArchived || !c.is_archived)
  const moveCheck = (id: string, dir: -1 | 1) => {
    const next = moveWithin(tree.checkTypes.map((c) => c.id), id, dir, (other) => !showArchived && !!tree.checkTypes.find((c) => c.id === other)?.is_archived)
    if (next) run(() => reorderCheckTypesAction(tree.id, next))
  }

  return (
    <div>
      <BackLink href="/admin/campaigns" label="All Special Checks" />

      {/* ── header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{tree.name}</h1>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {tree.is_archived
              ? <Chip bg="var(--surface-1)" color="var(--text-muted)">Archived</Chip>
              : readiness.ready
                ? <Chip bg="#E5F5EC" color="var(--status-green)">Active — offered on new audits</Chip>
                : <Chip bg="var(--highlight-light)" color="var(--text-primary)">Active — not offered yet (setup incomplete)</Chip>}
            <Chip bg="var(--brand-light)" color="var(--brand)">{scopeLabel(tree)}</Chip>
            {usage.campaign.submitted > 0 && <Chip bg="var(--surface-1)" color="var(--text-secondary)">Used in {usage.campaign.submitted} submitted audit{usage.campaign.submitted === 1 ? '' : 's'}</Chip>}
            {usage.campaign.draft > 0 && <Chip bg="var(--surface-1)" color="var(--text-secondary)">{usage.campaign.draft} draft{usage.campaign.draft === 1 ? '' : 's'} in progress</Chip>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button disabled={busy} style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }}
            onClick={() => run(() => setCampaignArchivedAction(tree.id, !tree.is_archived))}>
            {tree.is_archived ? 'Un-archive' : 'Archive'}
          </button>
          <button
            disabled={busy || campaignUsed}
            title={campaignUsed ? 'This Special Check has been attached to audits, so it can\'t be deleted — archive it instead.' : 'Delete this Special Check'}
            style={{ ...dangerBtn, ...(busy || campaignUsed ? disabledStyle : {}) }}
            onClick={deleteCampaign}
          >
            Delete
          </button>
        </div>
      </div>

      {tree.is_archived && (
        <Note tone="muted">
          This Special Check is archived: it no longer appears when auditing, but it stays on the audits that used it and in the reports. Un-archive it to use it again.
        </Note>
      )}
      {!tree.is_archived && !readiness.ready && (
        <Note tone="warn">
          <b>Not offered on new audits yet.</b> A Special Check appears on the scorecard once it has at least one check and every active check has {OPTION_LIMITS.min}–{OPTION_LIMITS.max} active options:
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>{readiness.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Note>
      )}
      {error && (
        <div role="alert" style={{ marginBottom: '16px', padding: '10px 14px', fontSize: '13px', background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', color: 'var(--alert)' }}>
          {error}
        </div>
      )}

      {/* ── details ── */}
      <section style={{ ...card, marginBottom: '24px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 14px' }}>Details</h2>
        <CampaignForm
          mode="edit"
          campaignId={tree.id}
          initial={{ name: tree.name, description: tree.description ?? '', allTeams: tree.all_teams, teamNames: tree.team_names }}
        />
      </section>

      {/* ── checks ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 12px', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ fontSize: '17px', fontWeight: 600, margin: 0 }}>Checks</h2>
        {(archivedChecks > 0 || tree.checkTypes.some((c) => c.values.some((v) => v.is_archived))) && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Each check is a question the auditor answers by picking <b>one</b> option from a fixed list of {OPTION_LIMITS.min}–{OPTION_LIMITS.max} — there is no free-text &ldquo;Other&rdquo;.
      </p>

      {visibleChecks.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', marginBottom: '14px' }}>
          {tree.checkTypes.length === 0 ? 'No checks yet — add the first one below.' : 'All checks are archived. Tick “Show archived” to see them.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
        {visibleChecks.map((check, i) => (
          <CheckCard
            key={check.id}
            check={check}
            tree={tree}
            campaignId={tree.id}
            usage={usage}
            showArchived={showArchived}
            busy={busy}
            canMoveUp={i > 0}
            canMoveDown={i < visibleChecks.length - 1}
            onMove={(dir) => moveCheck(check.id, dir)}
            run={run}
          />
        ))}
      </div>

      <AddCheckForm campaignId={tree.id} busy={busy} run={run} />
    </div>
  )
}

// ── one check with its options ───────────────────────────────

function CheckCard({
  check, tree, campaignId, usage, showArchived, busy, canMoveUp, canMoveDown, onMove, run,
}: {
  check: CampaignTreeCheck
  tree: CampaignTree
  campaignId: string
  usage: CampaignUsage
  showArchived: boolean
  busy: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (dir: -1 | 1) => void
  run: (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(check.name)
  const [description, setDescription] = useState(check.description ?? '')
  const [newOption, setNewOption] = useState('')
  const [newOptionIsMistake, setNewOptionIsMistake] = useState(false)
  useUnsavedGuard(newOption.trim() !== '' || (editing && (name !== check.name || description !== (check.description ?? ''))))

  const u = usage.checks[check.id] ?? NO_USE
  const nameLocked = u.submitted > 0       // a submitted audit answered this check: its text is frozen
  const active = activeOptions(check).length
  const shortOfOptions = !check.is_archived && active < OPTION_LIMITS.min
  const atCap = active >= OPTION_LIMITS.max
  const visibleOptions = check.values.filter((v) => showArchived || !v.is_archived)

  const moveOption = (id: string, dir: -1 | 1) => {
    const next = moveWithin(check.values.map((v) => v.id), id, dir, (other) => !showArchived && !!check.values.find((v) => v.id === other)?.is_archived)
    if (next) run(() => reorderOptionsAction(check.id, campaignId, next))
  }

  async function addOption(e: React.FormEvent) {
    e.preventDefault()
    if (await run(() => createOptionAction(check.id, campaignId, newOption, newOptionIsMistake))) { setNewOption(''); setNewOptionIsMistake(false) }
  }

  async function saveCheck(e: React.FormEvent) {
    e.preventDefault()
    if (await run(() => updateCheckTypeAction(check.id, campaignId, { name, description }))) setEditing(false)
  }

  function deleteCheck() {
    const warning = checkRemovalWarning(tree, check.id, 'Deleting')
    const base = `Delete the check "${check.name}" and its ${check.values.length} option${check.values.length === 1 ? '' : 's'}? This can't be undone.`
    if (!confirm(warning ? `${base}\n\n${warning}` : base)) return
    run(() => deleteCheckTypeAction(check.id, campaignId))
  }

  function toggleArchiveCheck() {
    if (!check.is_archived) {
      const warning = checkRemovalWarning(tree, check.id, 'Archiving')
      if (warning && !confirm(`${warning}\n\nArchive anyway?`)) return
    }
    run(() => setCheckTypeArchivedAction(check.id, campaignId, !check.is_archived))
  }

  return (
    <section style={{ ...card, opacity: check.is_archived ? 0.75 : 1 }} aria-label={`Check: ${check.name}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <form onSubmit={saveCheck} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                aria-label="Check text" style={{ ...inputStyle, ...(nameLocked ? disabledStyle : {}) }} value={name} maxLength={CAMPAIGN_LIMITS.checkName}
                disabled={nameLocked} onChange={(e) => setName(e.target.value)}
                title={nameLocked ? 'A submitted audit answered this check, so its text is locked.' : undefined}
              />
              {nameLocked && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  The text is locked: {u.submitted} submitted audit{u.submitted === 1 ? '' : 's'} answered this check, and changing the question would change what those answers meant.
                  To ask something different, archive this check and add a new one. You can still edit the note.
                </div>
              )}
              <input aria-label="Check note" style={inputStyle} value={description} maxLength={CAMPAIGN_LIMITS.checkDescription} placeholder="Optional note for the auditor" onChange={(e) => setDescription(e.target.value)} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn, padding: '6px 14px', fontSize: '13px', ...(busy ? disabledStyle : {}) }}>Save</button>
                <button type="button" style={ghostBtn} onClick={() => { setEditing(false); setName(check.name); setDescription(check.description ?? '') }}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ fontSize: '15px', fontWeight: 600, overflowWrap: 'anywhere' }}>{check.name}</div>
              {check.description && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{check.description}</div>}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {check.is_archived && <Chip bg="var(--surface-1)" color="var(--text-muted)">Archived</Chip>}
                <Chip
                  bg={shortOfOptions ? 'var(--highlight-light)' : 'var(--surface-1)'}
                  color={shortOfOptions ? 'var(--text-primary)' : 'var(--text-secondary)'}
                >
                  {active} of {OPTION_LIMITS.max} active options{shortOfOptions ? ` — needs at least ${OPTION_LIMITS.min}` : ''}
                </Chip>
                {u.submitted > 0 && <Chip bg="var(--surface-1)" color="var(--text-secondary)">Used in {u.submitted} submitted audit{u.submitted === 1 ? '' : 's'}</Chip>}
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <IconBtn label="Move check up" disabled={busy || !canMoveUp} onClick={() => onMove(-1)}>↑</IconBtn>
            <IconBtn label="Move check down" disabled={busy || !canMoveDown} onClick={() => onMove(1)}>↓</IconBtn>
            <button style={ghostBtn} disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            <button style={ghostBtn} disabled={busy} onClick={toggleArchiveCheck}>
              {check.is_archived ? 'Un-archive' : 'Archive'}
            </button>
            <button
              style={{ ...dangerBtn, ...(isUsed(u) ? disabledStyle : {}) }}
              disabled={busy || isUsed(u)}
              title={isUsed(u) ? 'Audits have answered this check, so it can\'t be deleted — archive it instead.' : 'Delete this check'}
              onClick={deleteCheck}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* options */}
      <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)' }}>
        {visibleOptions.length === 0 && (
          <div style={{ padding: '14px 0 4px', fontSize: '13px', color: 'var(--text-muted)' }}>No options yet — add at least {OPTION_LIMITS.min}.</div>
        )}
        {visibleOptions.map((option, i) => (
          <OptionRow
            key={option.id}
            option={option}
            campaignId={campaignId}
            usage={usage.options[option.id] ?? NO_USE}
            busy={busy}
            canMoveUp={i > 0}
            canMoveDown={i < visibleOptions.length - 1}
            onMove={(dir) => moveOption(option.id, dir)}
            capReached={atCap}
            archiveWarning={optionRemovalWarning(tree, check.id, option.id, 'Archiving')}
            deleteWarning={optionRemovalWarning(tree, check.id, option.id, 'Deleting')}
            run={run}
          />
        ))}

        <form onSubmit={addOption} style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            aria-label={`New option for ${check.name}`} style={{ ...inputStyle, flex: 1, minWidth: '180px' }}
            value={newOption} maxLength={CAMPAIGN_LIMITS.option} disabled={atCap}
            placeholder={atCap ? `Already ${OPTION_LIMITS.max} active options — archive one to add another` : 'Add an option, e.g. “Yes — in the opening”'}
            onChange={(e) => setNewOption(e.target.value)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: atCap ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={newOptionIsMistake} disabled={atCap} onChange={(e) => setNewOptionIsMistake(e.target.checked)} />
            Mark as mistake
          </label>
          <button type="submit" disabled={busy || atCap || !newOption.trim()} style={{ ...primaryBtn, padding: '8px 16px', fontSize: '13px', ...(busy || atCap || !newOption.trim() ? disabledStyle : {}) }}>
            Add option
          </button>
        </form>
      </div>
    </section>
  )
}

function OptionRow({
  option, campaignId, usage, busy, canMoveUp, canMoveDown, onMove, capReached, archiveWarning, deleteWarning, run,
}: {
  option: CampaignCheckValue
  campaignId: string
  usage: Usage
  busy: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (dir: -1 | 1) => void
  capReached: boolean
  /** Set when archiving/deleting this option would leave its check with too few active options. */
  archiveWarning: string | null
  deleteWarning: string | null
  run: (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(option.label)
  useUnsavedGuard(editing && label !== option.label)
  const textLocked = usage.submitted > 0
  const cannotUnarchive = option.is_archived && capReached

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (await run(() => updateOptionAction(option.id, campaignId, label))) setEditing(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', opacity: option.is_archived ? 0.7 : 1 }}>
      <div style={{ flex: 1, minWidth: '160px' }}>
        {editing ? (
          <form onSubmit={save} style={{ display: 'flex', gap: '8px' }}>
            <input aria-label="Option text" style={inputStyle} value={label} maxLength={CAMPAIGN_LIMITS.option} onChange={(e) => setLabel(e.target.value)} autoFocus />
            <button type="submit" disabled={busy} style={{ ...primaryBtn, padding: '6px 14px', fontSize: '13px' }}>Save</button>
            <button type="button" style={ghostBtn} onClick={() => { setEditing(false); setLabel(option.label) }}>Cancel</button>
          </form>
        ) : (
          <span style={{ fontSize: '14px', overflowWrap: 'anywhere' }}>
            {option.label}
            {option.is_archived && <span style={{ marginLeft: '8px' }}><Chip bg="var(--surface-1)" color="var(--text-muted)">Archived</Chip></span>}
            {option.is_mistake && <span style={{ marginLeft: '8px' }}><Chip bg="var(--alert-light)" color="var(--alert)">Mistake</Chip></span>}
            {usage.submitted > 0 && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>used in {usage.submitted}</span>}
          </span>
        )}
      </div>
      {!editing && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <IconBtn label={`Move ${option.label} up`} disabled={busy || !canMoveUp} onClick={() => onMove(-1)}>↑</IconBtn>
          <IconBtn label={`Move ${option.label} down`} disabled={busy || !canMoveDown} onClick={() => onMove(1)}>↓</IconBtn>
          <button
            style={ghostBtn}
            disabled={busy}
            title={option.is_mistake ? 'No longer flag this answer as a mistake' : 'Flag this answer as a mistake in the Special Check Report'}
            onClick={() => run(() => setOptionMistakeAction(option.id, campaignId, !option.is_mistake))}
          >
            {option.is_mistake ? 'Unmark mistake' : 'Mark as mistake'}
          </button>
          <button
            style={{ ...ghostBtn, ...(textLocked ? disabledStyle : {}) }}
            disabled={busy || textLocked}
            title={textLocked ? 'A submitted audit used this option, so its text is locked — archive it and add a new option instead.' : 'Rename'}
            onClick={() => setEditing(true)}
          >
            Rename
          </button>
          <button
            style={{ ...ghostBtn, ...(cannotUnarchive ? disabledStyle : {}) }}
            disabled={busy || cannotUnarchive}
            title={cannotUnarchive ? `There are already ${OPTION_LIMITS.max} active options — archive another first.` : undefined}
            onClick={() => {
              if (!option.is_archived && archiveWarning && !confirm(`${archiveWarning}\n\nArchive anyway?`)) return
              run(() => setOptionArchivedAction(option.id, campaignId, !option.is_archived))
            }}
          >
            {option.is_archived ? 'Un-archive' : 'Archive'}
          </button>
          <button
            style={{ ...dangerBtn, ...(isUsed(usage) ? disabledStyle : {}) }}
            disabled={busy || isUsed(usage)}
            title={isUsed(usage) ? 'Audits have used this option, so it can\'t be deleted — archive it instead.' : 'Delete this option'}
            onClick={() => {
              const base = `Delete the option "${option.label}"?`
              if (confirm(deleteWarning ? `${base}\n\n${deleteWarning}` : base)) run(() => deleteOptionAction(option.id, campaignId))
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function AddCheckForm({
  campaignId, busy, run,
}: {
  campaignId: string
  busy: boolean
  run: (action: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  useUnsavedGuard(name.trim() !== '' || description.trim() !== '')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (await run(() => createCheckTypeAction(campaignId, { name, description }))) { setName(''); setDescription('') }
  }

  return (
    <form onSubmit={add} style={{ ...card, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '14px', fontWeight: 600 }}>Add a check</div>
      <input aria-label="New check text" style={inputStyle} value={name} maxLength={CAMPAIGN_LIMITS.checkName} placeholder="What should be checked? e.g. “Mentioned the new course launch?”" onChange={(e) => setName(e.target.value)} />
      <input aria-label="New check note" style={inputStyle} value={description} maxLength={CAMPAIGN_LIMITS.checkDescription} placeholder="Optional note for the auditor" onChange={(e) => setDescription(e.target.value)} />
      <div>
        <button type="submit" disabled={busy || !name.trim()} style={{ ...primaryBtn, ...(busy || !name.trim() ? disabledStyle : {}) }}>Add check</button>
      </div>
    </form>
  )
}

// ── small pieces ─────────────────────────────────────────────

function Chip({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: bg, color, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function Note({ tone, children }: { tone: 'warn' | 'muted'; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: '16px', padding: '12px 16px', fontSize: '13px', lineHeight: 1.6, borderRadius: 'var(--radius-md)',
      borderStyle: 'solid', borderWidth: '1px',
      borderColor: tone === 'warn' ? 'var(--highlight)' : 'var(--border)',
      background: tone === 'warn' ? 'var(--highlight-light)' : 'var(--surface-1)', color: 'var(--text-primary)',
    }}>
      {children}
    </div>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick} style={{ ...ghostBtn, padding: '6px 10px', ...(disabled ? disabledStyle : {}) }}>
      {children}
    </button>
  )
}
