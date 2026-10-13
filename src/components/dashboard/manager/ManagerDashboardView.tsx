'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { ChannelGroup, ManagerRollup, Metrics, TeamLeadGroup } from '@/lib/manager/rollup'
import type { ManagerOverview } from '@/lib/manager/manager-overview.service'
import { AgentQueueTable } from '../AgentQueueTable'
import { formatUsd } from '@/lib/money/usd'
import { formatDhakaDateTime } from '@/lib/dates/format'

const agentProfileHref = (id: string) => `/dashboard/manager/agent/${id}`

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`)

/** No per-audit link here — a Manager can't open /audits/{id} (excluded from that route, §9 Part
 * 2: "a Manager doesn't audit calls") — only the agent-profile link, same as everywhere else on
 * this dashboard. */
function AgentLink({ id, name }: { id: string; name: string }) {
  return <Link href={agentProfileHref(id)} prefetch={false} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>{name}</Link>
}

export function ManagerDashboardView({ rollup, managerName, overview }: { rollup: ManagerRollup; managerName: string; overview: ManagerOverview }) {
  const { overview: metricsOverview, groups, activeTeamLeads, channelGroups } = rollup
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openChannel, setOpenChannel] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleChannel = (key: string) =>
    setOpenChannel((prev) => {
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
        <Card label="Agents" value={String(metricsOverview.agents)} />
        <Card
          label="Audit coverage"
          value={pct(metricsOverview.coverage)}
          sub={`${metricsOverview.audited_agents} of ${metricsOverview.agents} agents audited`}
        />
        <Card label="Audits completed" value={String(metricsOverview.audits)} />
        <Card label="Average score" value={pct(metricsOverview.avg_score)} />
        <Card label="Pass rate" value={pct(metricsOverview.pass_rate)} />
        <Card
          label="Critical fails"
          value={String(metricsOverview.critical_fails)}
          color={metricsOverview.critical_fails > 0 ? 'var(--alert)' : undefined}
        />
      </div>

      {metricsOverview.audits === 0 && (
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
              <MetricCells m={metricsOverview} />
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.6 }}>
        Counts submitted audits only (drafts excluded), dated by submission. The sales week runs Saturday–Friday, Dhaka time.
        Coverage is agents audited at least once ÷ current agents. Click a Team Lead to see their agents.
      </p>

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '28px 0 4px' }}>By Channel</h2>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
        The exact same figures above, regrouped by team/channel instead of by Team Lead — useful when your chain spans more than one.
      </p>
      <div style={{ overflowX: 'auto', background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
              {['Channel', 'Agents', 'Coverage', 'Audits', 'Avg score', 'Pass rate', 'Critical'].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelGroups.map((g) => (
              <ChannelGroupRows key={g.channel} group={g} isOpen={openChannel.has(g.channel)} onToggle={() => toggleChannel(g.channel)} />
            ))}
            <tr style={{ borderTop: '2px solid var(--border-strong)', background: 'var(--surface-0)', fontWeight: 600 }}>
              <td style={td}>Total</td>
              <MetricCells m={metricsOverview} />
            </tr>
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '28px 0 10px' }}>Fatal incidents</h2>
      <div style={card}>
        <p style={sectionNote}>Every critical-fatal audit on your chain in this period.</p>
        {overview.fatalIncidents.length === 0 ? <p style={empty}>None in this period.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Fatal item(s)</th><th style={th}>Auditor</th><th style={th}>Submitted</th><th style={th}>Lifetime fatals</th></tr></thead>
              <tbody>
                {overview.fatalIncidents.map((f) => (
                  <tr key={f.auditId}>
                    <td style={td}><AgentLink id={f.agentId} name={f.agentName} /></td>
                    <td style={{ ...td, whiteSpace: 'normal', minWidth: '220px' }}>{f.fatalParameters.length === 0 ? '—' : f.fatalParameters.join('; ')}</td>
                    <td style={td}>{f.auditorName ?? '—'}</td>
                    <td style={td}>{formatDhakaDateTime(f.submittedAt)}</td>
                    <td style={td}>
                      <span style={{ fontWeight: f.lifetimeFatalCount >= 2 ? 700 : 400, color: f.lifetimeFatalCount >= 2 ? 'var(--alert)' : 'inherit' }}>{f.lifetimeFatalCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '28px 0 10px' }}>Zero-Seller</h2>
      <div style={card}>
        <p style={sectionNote}>Anyone on your chain currently on an active zero-seller streak.</p>
        {overview.zeroSellers.length === 0 ? <p style={empty}>Nobody on your chain is a zero-seller right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Vintage</th><th style={th}>Streak (weeks)</th><th style={th}>Last sale</th><th style={th}>Days since</th><th style={th}>Revenue that day</th></tr></thead>
              <tbody>
                {overview.zeroSellers.map((z) => (
                  <tr key={z.agentId}>
                    <td style={td}><AgentLink id={z.agentId} name={z.agentName} /></td>
                    <td style={td}>{z.vintage.label}</td>
                    <td style={td}>{z.currentStreakWeeks}</td>
                    <td style={td}>{z.lastSaleDate ?? 'None on record'}</td>
                    <td style={td}>{z.daysSinceLastSale ?? '—'}</td>
                    <td style={td}>{formatUsd(z.lastSaleRevenueUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '28px 0 10px' }}>PIP — current cycle</h2>
      <div style={card}>
        <p style={sectionNote}>Anyone on your chain currently on a PIP, and how they&apos;re tracking against target.</p>
        {overview.pipLive.length === 0 ? <p style={empty}>Nobody on your chain is on a PIP right now.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
              <thead><tr><th style={th}>Agent</th><th style={th}>Target</th><th style={th}>Achieved</th><th style={th}>Remaining</th><th style={th}>Days left</th><th style={th}>Run rate needed / day</th><th style={th}>Last sale</th><th style={th}></th></tr></thead>
              <tbody>
                {overview.pipLive.map((p) => (
                  <tr key={p.agentId}>
                    <td style={td}><AgentLink id={p.agentId} name={p.agentName} /></td>
                    <td style={td}>{formatUsd(p.targetUsd)}</td>
                    <td style={td}>{formatUsd(p.achievedUsd)}</td>
                    <td style={td}>{p.targetMet ? <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>$0.00</span> : formatUsd(p.remainingUsd)}</td>
                    <td style={td}>{p.daysLeft}</td>
                    <td style={td}>{p.targetMet ? <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>Target met</span> : p.runRateRequiredUsdPerDay !== null ? formatUsd(p.runRateRequiredUsdPerDay) : '—'}</td>
                    <td style={td}>{p.lastSaleDate ?? 'None on record'}</td>
                    <td style={td}><Link href={`/pip/${p.candidateId}`} prefetch={false} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Feedback &amp; training →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ChannelGroupRows({ group, isOpen, onToggle }: { group: ChannelGroup; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
        <td style={td}>
          <span style={{ display: 'inline-block', width: '14px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
          <b>{group.channel}</b>
        </td>
        <MetricCells m={group.metrics} />
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} style={{ padding: '10px 10px 10px 26px', background: 'var(--surface-0)' }}>
            <AgentQueueTable ranked={group.rankedAgents} reTraining={group.reTraining} agentProfileHref={agentProfileHref} emptyMessage="No agents in this channel." />
          </td>
        </tr>
      )}
    </>
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
          <td colSpan={8} style={{ padding: '10px 10px 10px 26px', background: 'var(--surface-0)' }}>
            <AgentQueueTable ranked={group.rankedAgents} reTraining={group.reTraining} agentProfileHref={agentProfileHref} emptyMessage="No agents under this Team Lead." />
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
const emptyBox: React.CSSProperties = {
  background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '24px', color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', lineHeight: 1.6,
}
const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }
