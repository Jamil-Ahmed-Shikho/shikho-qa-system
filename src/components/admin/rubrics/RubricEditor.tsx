'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateRubricMeta,
  toggleRubricActive,
  createRubricVersion,
  setTeamMapping,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategory,
  createParameter,
  updateParameter,
  deleteParameter,
  createErrorAttribute,
  updateErrorAttribute,
  deleteErrorAttribute,
  createFatalParameter,
  updateFatalParameter,
  deleteFatalParameter,
} from '@/lib/rubrics/actions'
import { TEAM_NAMES } from '@/types/database.types'
import type { RubricWithTree, FatalSeverity } from '@/types/database.types'

const card: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '20px',
  marginBottom: '20px',
}

const smallInput: React.CSSProperties = {
  padding: '7px 10px',
  fontSize: '13px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  outline: 'none',
}

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--brand)',
  background: 'var(--brand-light)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

const dangerBtn: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '12px',
  color: 'var(--alert)',
  background: 'var(--alert-light)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
}

export function RubricEditor({ rubric }: { rubric: RubricWithTree }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function run(fn: () => Promise<unknown>) {
    setErrorMsg(null)
    startTransition(async () => {
      try {
        await fn()
        router.refresh()
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      }
    })
  }

  const totalAssigned = rubric.rubric_categories.reduce(
    (sum, cat) => sum + cat.rubric_parameters.reduce((s, p) => s + Number(p.points), 0),
    0
  )
  const pointsMismatch = totalAssigned !== Number(rubric.total_points)

  return (
    <div>
      {errorMsg && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '14px',
          color: 'var(--alert)', marginBottom: '16px',
        }}>
          {errorMsg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <MetaEditor rubric={rubric} onSave={(input) => run(() => updateRubricMeta(rubric.id, input))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            <span style={{
              fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)',
              background: rubric.is_active ? '#E5F5EC' : 'var(--surface-1)',
              color: rubric.is_active ? 'var(--status-green)' : 'var(--text-muted)',
            }}>
              v{rubric.version} · {rubric.is_active ? 'Active' : 'Superseded'}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                disabled={pending}
                onClick={() => run(() => toggleRubricActive(rubric.id, !rubric.is_active))}
                style={ghostBtn}
              >
                {rubric.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                disabled={pending}
                onClick={() => {
                  if (confirm(`Create v${rubric.version + 1} of "${rubric.name}"? This copies the whole rubric and supersedes v${rubric.version}.`)) {
                    run(() => createRubricVersion(rubric.id))
                  }
                }}
                style={ghostBtn}
              >
                Create New Version
              </button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: '10px', fontSize: '13px', color: pointsMismatch ? 'var(--alert)' : 'var(--text-muted)' }}>
          {totalAssigned} / {rubric.total_points} pts assigned across parameters
          {pointsMismatch && ' — adjust parameter points or the rubric total before using this rubric in audits.'}
        </div>
      </div>

      {/* ── Team mapping ── */}
      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>Teams using this rubric</h3>
        <TeamMappingEditor
          rubricId={rubric.id}
          current={rubric.team_rubric_mapping.map((m) => m.team_name)}
          onSave={(teams) => run(() => setTeamMapping(rubric.id, teams))}
        />
      </div>

      {/* ── Categories / Parameters / Error attributes ── */}
      <div style={card}>
        <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 600 }}>Categories &amp; Parameters</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {rubric.rubric_categories.map((cat, i) => (
            <CategoryBlock
              key={cat.id}
              rubricId={rubric.id}
              category={cat}
              isFirst={i === 0}
              isLast={i === rubric.rubric_categories.length - 1}
              run={run}
            />
          ))}
        </div>
        <AddCategoryForm rubricId={rubric.id} run={run} />
      </div>

      {/* ── Fatal parameters ── */}
      <div style={card}>
        <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>Fatal Errors</h3>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
          Any Critical tick auto-zeroes the whole audit.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rubric.fatal_parameters.map((f) => (
            <FatalRow key={f.id} rubricId={rubric.id} fatal={f} run={run} />
          ))}
        </div>
        <AddFatalForm rubricId={rubric.id} run={run} />
      </div>
    </div>
  )
}

// ── Rubric meta (name / total points) ──────────────────────

function MetaEditor({
  rubric,
  onSave,
}: {
  rubric: RubricWithTree
  onSave: (input: { name: string; total_points: number }) => void
}) {
  const [name, setName] = useState(rubric.name)
  const [totalPoints, setTotalPoints] = useState(rubric.total_points)
  const dirty = name !== rubric.name || totalPoints !== rubric.total_points

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ ...smallInput, fontSize: '18px', fontWeight: 600, padding: '6px 10px', minWidth: '220px' }}
      />
      <input
        type="number"
        value={totalPoints}
        onChange={(e) => setTotalPoints(Number(e.target.value))}
        style={{ ...smallInput, width: '90px' }}
      />
      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>pts</span>
      {dirty && (
        <button style={ghostBtn} onClick={() => onSave({ name, total_points: totalPoints })}>
          Save
        </button>
      )}
    </div>
  )
}

// ── Team mapping ────────────────────────────────────────────

function TeamMappingEditor({
  current,
  onSave,
}: {
  rubricId: string
  current: string[]
  onSave: (teams: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(current)
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...current].sort())

  function toggle(team: string) {
    setSelected((prev) => (prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]))
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: dirty ? '12px' : 0 }}>
        {TEAM_NAMES.map((team) => (
          <label
            key={team}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px',
              padding: '6px 12px', borderRadius: 'var(--radius-pill)',
              border: `1px solid ${selected.includes(team) ? 'var(--brand)' : 'var(--border)'}`,
              background: selected.includes(team) ? 'var(--brand-light)' : 'var(--surface-2)',
              cursor: 'pointer',
            }}
          >
            <input type="checkbox" checked={selected.includes(team)} onChange={() => toggle(team)} />
            {team}
          </label>
        ))}
      </div>
      {dirty && (
        <button style={ghostBtn} onClick={() => onSave(selected)}>
          Save team mapping
        </button>
      )}
    </div>
  )
}

// ── Category block ──────────────────────────────────────────

function CategoryBlock({
  rubricId,
  category,
  isFirst,
  isLast,
  run,
}: {
  rubricId: string
  category: RubricWithTree['rubric_categories'][number]
  isFirst: boolean
  isLast: boolean
  run: (fn: () => Promise<unknown>) => void
}) {
  const [name, setName] = useState(category.name)
  const dirty = name !== category.name

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...smallInput, fontWeight: 600, flex: 1 }}
        />
        {dirty && (
          <button style={ghostBtn} onClick={() => run(() => updateCategory(category.id, rubricId, name))}>
            Save
          </button>
        )}
        <button disabled={isFirst} style={{ ...ghostBtn, opacity: isFirst ? 0.4 : 1 }} onClick={() => run(() => moveCategory(rubricId, category.id, 'up'))}>
          <i className="ti ti-arrow-up" />
        </button>
        <button disabled={isLast} style={{ ...ghostBtn, opacity: isLast ? 0.4 : 1 }} onClick={() => run(() => moveCategory(rubricId, category.id, 'down'))}>
          <i className="ti ti-arrow-down" />
        </button>
        <button
          style={dangerBtn}
          onClick={() => {
            if (confirm(`Delete category "${category.name}" and all its parameters?`)) {
              run(() => deleteCategory(category.id, rubricId))
            }
          }}
        >
          Delete
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingLeft: '8px' }}>
        {category.rubric_parameters.map((param) => (
          <ParameterRow key={param.id} rubricId={rubricId} parameter={param} run={run} />
        ))}
      </div>

      <AddParameterForm categoryId={category.id} rubricId={rubricId} run={run} />
    </div>
  )
}

function AddCategoryForm({ rubricId, run }: { rubricId: string; run: (fn: () => Promise<unknown>) => void }) {
  const [name, setName] = useState('')
  return (
    <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category name"
        style={{ ...smallInput, flex: 1 }}
      />
      <button
        style={ghostBtn}
        disabled={!name}
        onClick={() => {
          run(() => createCategory(rubricId, name))
          setName('')
        }}
      >
        + Add category
      </button>
    </div>
  )
}

// ── Parameter row ────────────────────────────────────────────

function ParameterRow({
  rubricId,
  parameter,
  run,
}: {
  rubricId: string
  parameter: RubricWithTree['rubric_categories'][number]['rubric_parameters'][number]
  run: (fn: () => Promise<unknown>) => void
}) {
  const [name, setName] = useState(parameter.name)
  const [points, setPoints] = useState(parameter.points)
  const dirty = name !== parameter.name || points !== parameter.points

  return (
    <div style={{ background: 'var(--surface-0)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...smallInput, flex: 1 }} />
        <input
          type="number"
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          style={{ ...smallInput, width: '70px' }}
        />
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>pts</span>
        {dirty && (
          <button style={ghostBtn} onClick={() => run(() => updateParameter(parameter.id, rubricId, { name, points }))}>
            Save
          </button>
        )}
        <button
          style={dangerBtn}
          onClick={() => {
            if (confirm(`Delete parameter "${parameter.name}"?`)) run(() => deleteParameter(parameter.id, rubricId))
          }}
        >
          Delete
        </button>
      </div>

      <div style={{ marginTop: '8px', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {parameter.rubric_error_attributes.map((ea) => (
          <ErrorAttributeRow key={ea.id} rubricId={rubricId} attribute={ea} run={run} />
        ))}
        <AddErrorAttributeForm parameterId={parameter.id} rubricId={rubricId} run={run} />
      </div>
    </div>
  )
}

function AddParameterForm({
  categoryId,
  rubricId,
  run,
}: {
  categoryId: string
  rubricId: string
  run: (fn: () => Promise<unknown>) => void
}) {
  const [name, setName] = useState('')
  const [points, setPoints] = useState(5)
  return (
    <div style={{ display: 'flex', gap: '8px', marginTop: '10px', paddingLeft: '8px' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New parameter name"
        style={{ ...smallInput, flex: 1 }}
      />
      <input
        type="number"
        value={points}
        onChange={(e) => setPoints(Number(e.target.value))}
        style={{ ...smallInput, width: '70px' }}
      />
      <button
        style={ghostBtn}
        disabled={!name}
        onClick={() => {
          run(() => createParameter(categoryId, rubricId, { name, points }))
          setName('')
        }}
      >
        + Add parameter
      </button>
    </div>
  )
}

// ── Error attribute row ──────────────────────────────────────

function ErrorAttributeRow({
  rubricId,
  attribute,
  run,
}: {
  rubricId: string
  attribute: { id: string; description: string }
  run: (fn: () => Promise<unknown>) => void
}) {
  const [description, setDescription] = useState(attribute.description)
  const dirty = description !== attribute.description

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>•</span>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ ...smallInput, flex: 1, fontSize: '12px', padding: '5px 8px' }}
      />
      {dirty && (
        <button style={ghostBtn} onClick={() => run(() => updateErrorAttribute(attribute.id, rubricId, description))}>
          Save
        </button>
      )}
      <button style={dangerBtn} onClick={() => run(() => deleteErrorAttribute(attribute.id, rubricId))}>
        ×
      </button>
    </div>
  )
}

function AddErrorAttributeForm({
  parameterId,
  rubricId,
  run,
}: {
  parameterId: string
  rubricId: string
  run: (fn: () => Promise<unknown>) => void
}) {
  const [description, setDescription] = useState('')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>•</span>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="New error attribute"
        style={{ ...smallInput, flex: 1, fontSize: '12px', padding: '5px 8px' }}
      />
      <button
        style={{ ...ghostBtn, padding: '4px 10px' }}
        disabled={!description}
        onClick={() => {
          run(() => createErrorAttribute(parameterId, rubricId, description))
          setDescription('')
        }}
      >
        + Add
      </button>
    </div>
  )
}

// ── Fatal parameters ─────────────────────────────────────────

function FatalRow({
  rubricId,
  fatal,
  run,
}: {
  rubricId: string
  fatal: { id: string; description: string; severity: FatalSeverity }
  run: (fn: () => Promise<unknown>) => void
}) {
  const [description, setDescription] = useState(fatal.description)
  const [severity, setSeverity] = useState<FatalSeverity>(fatal.severity)
  const dirty = description !== fatal.description || severity !== fatal.severity

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ ...smallInput, flex: 1 }}
      />
      <select
        value={severity}
        onChange={(e) => setSeverity(e.target.value as FatalSeverity)}
        style={{
          ...smallInput,
          color: severity === 'critical' ? 'var(--alert)' : 'var(--highlight)',
          fontWeight: 600,
        }}
      >
        <option value="critical">Critical</option>
        <option value="major">Major</option>
      </select>
      {dirty && (
        <button
          style={ghostBtn}
          onClick={() => run(() => updateFatalParameter(fatal.id, rubricId, { description, severity }))}
        >
          Save
        </button>
      )}
      <button
        style={dangerBtn}
        onClick={() => {
          if (confirm('Delete this fatal item?')) run(() => deleteFatalParameter(fatal.id, rubricId))
        }}
      >
        Delete
      </button>
    </div>
  )
}

function AddFatalForm({ rubricId, run }: { rubricId: string; run: (fn: () => Promise<unknown>) => void }) {
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<FatalSeverity>('critical')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="New fatal error description"
        style={{ ...smallInput, flex: 1 }}
      />
      <select value={severity} onChange={(e) => setSeverity(e.target.value as FatalSeverity)} style={smallInput}>
        <option value="critical">Critical</option>
        <option value="major">Major</option>
      </select>
      <button
        style={ghostBtn}
        disabled={!description}
        onClick={() => {
          run(() => createFatalParameter(rubricId, { description, severity }))
          setDescription('')
        }}
      >
        + Add
      </button>
    </div>
  )
}
