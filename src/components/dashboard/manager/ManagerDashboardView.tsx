'use client'

import { useState } from 'react'
import type { ManagerRollup, Metrics, TeamLeadGroup } from '@/lib/manager/rollup'

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`)
const STAGE_LABEL: Record<string, string> = {
  ojt: 'OJT', re_training: 'Re-training', active: 'Active', not_certified: 'Not certified', discontinued: 'Discontinued',
}

export function ManagerDashboardView({ rollup, managerName }: { rollup: ManagerRollup; managerName: string }) {
  const { overview, groups, activeTeamLeads } = rollup
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (groups.length === 0) {
    return (
      <div style={emptyBox}>
        No Team Leads report to {managerName} yet. Tag Team Leads to this person in <a href="/admin/users" style={{ color: 'var(--brand)', fontWeight: 600 }}>Users</a> using the
        Manager field, and they will appear here with their agents.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <Card label="Team Leads" value={String(activeTeamLeads)} />
        <Card label="Agents" value={String(overview.agents)} />
        <Card
          label="Audit coverage"
          value={pct(overview.coverage)}
          sub={`${overview.audited_agents} of ${overview.agents} agents audited`}
        />
        <Card label="Audits completed" value={String(overview.audits)} />
        <Card label="Average score" value={pct(overview.avg_score)} />
        <Card label="Pass rate" value={pct(overview.pass_rate)} />
        <Card
          label="Critical fails"
          value={String(overview.critical_fails)}
          color={overview.critical_fails > 0 ? 'var(--alert)' : undefined}
        />
      </div>

      {overview.audits === 0 && (
        <div style={{ ...emptyBox, marginBottom: '20px', textAlign: 'left' }}>
          No submitted audits in this period yet, so scores show as “—”. Agents and coverage are live; scores appear as auditors submit.
        </div>
      )}

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>By Team Lead</h2>
      <div style={{ overflowX: 'auto', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
              {['Team Lead', 'Team / Site', 'Agents', 'Coverage', 'Audits', 'Avg score', 'Pass rate', 'Critical'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const key = g.teamLead?.id ?? 'other'
              const isOpen = open.has(key)
              return (
                <GroupRows key={key} group={g} isOpen={isOpen} onToggle={() => toggle(key)} />
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--surface-0)', fontWeight: 600 }}>
              <td style={td} colSpan={2}>Total</td>
              <MetricCells m={overview} />
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.6 }}>
        Counts submitted audits only (drafts excluded), dated by submission. The sales week runs Saturday–Friday, Dhaka time.
        Coverage is agents audited at least once ÷ current agents. Click a Team Lead to see their agents.
      </p>
    </div>
  )
}

function GroupRows({ group, isOpen, onToggle }: { group: TeamLeadGroup; isOpen: boolean; onToggle: () => void }) {
  const tl = group.teamLead
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', opacity: tl && !tl.is_active ? 0.65 : 1 }}
      >
        <td style={td}>
          <span style={{ display: 'inline-block', width: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
          <b>{tl ? tl.name : 'Other agents'}</b>
          {tl && !tl.is_active && <span style={{ color: 'var(--text-muted)' }}> (deactivated)</span>}
          {!tl && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '14px' }}>Under a Team Lead who doesn’t report to you directly</div>}
        </td>
        <td style={td}>{tl ? [tl.team_name, tl.site_name].filter(Boolean).join(' · ') || '—' : '—'}</td>
        <MetricCells m={group.metrics} />
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={8} style={{ padding: 0, background: 'var(--surface-0)' }}>
            {group.agents.length === 0 ? (
              <div style={{ padding: '12px 16px 12px 36px', color: 'var(--text-muted)', fontSize: '12px' }}>No agents under this Team Lead.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ ...subTh, paddingLeft: '36px' }}>Agent</th>
                    <th style={subTh}>Team / Site</th>
                    <th style={subTh}>Stage</th>
                    <th style={{ ...subTh, textAlign: 'right' }}>Audits</th>
                    <th style={{ ...subTh, textAlign: 'right' }}>Avg score</th>
                    <th style={{ ...subTh, textAlign: 'right' }}>Pass rate</th>
                    <th style={{ ...subTh, textAlign: 'right' }}>Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {group.agents.map((a) => (
                    <tr key={a.agent_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...subTd, paddingLeft: '36px' }}>
                        <div style={{ fontWeight: 600 }}>{a.agent_name}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{a.agent_email}</div>
                      </td>
                      <td style={subTd}>{[a.team_name, a.site_name].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={subTd}>{STAGE_LABEL[a.employment_stage] ?? a.employment_stage}</td>
                      <td style={{ ...subTd, textAlign: 'right' }}>{a.audits_completed}</td>
                      <td style={{ ...subTd, textAlign: 'right' }}>{a.audits_completed ? pct(a.score_sum / a.audits_completed) : '—'}</td>
                      <td style={{ ...subTd, textAlign: 'right' }}>{a.audits_completed ? pct((a.audits_passed / a.audits_completed) * 100) : '—'}</td>
                      <td style={{ ...subTd, textAlign: 'right', color: a.critical_fails ? 'var(--alert)' : undefined, fontWeight: a.critical_fails ? 600 : undefined }}>
                        {a.critical_fails}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function MetricCells({ m }: { m: Metrics }) {
  const right = { ...td, textAlign: 'right' as const }
  return (
    <>
      <td style={right}>{m.agents}</td>
      <td style={right}>{m.coverage === null ? '—' : `${pct(m.coverage)} (${m.audited_agents}/${m.agents})`}</td>
      <td style={right}>{m.audits}</td>
      <td style={right}>{pct(m.avg_score)}</td>
      <td style={right}>{pct(m.pass_rate)}</td>
      <td style={{ ...right, color: m.critical_fails ? 'var(--alert)' : undefined, fontWeight: m.critical_fails ? 600 : undefined }}>
        {m.critical_fails}
      </td>
    </>
  )
}

function Card({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '12px', color: 'var(--text-secondary)' }
const td: React.CSSProperties = { padding: '10px 12px' }
const subTh: React.CSSProperties = { padding: '8px 12px', fontWeight: 500 }
const subTd: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' }
const emptyBox: React.CSSProperties = {
  background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '24px', color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', lineHeight: 1.6,
}
