import Link from 'next/link'
import { formatUsd } from '@/lib/money/usd'
import type { RankedRow } from '@/lib/queue/priority'
import type { OjtCandidate } from '@/lib/ojt/ojt.service'

// ============================================================
// The priority-ranked agent table QA's "Who to audit next" (QueueSection)
// originated — extracted 2026-10-04 so Team Lead and Manager dashboards can
// show the SAME view (Jamil's own request: "same view like Auditor will be
// good enough... with all QA, TL, Manager view"), instead of each having a
// thinner, differently-shaped table. Everything about WHAT the columns mean
// and HOW rows are ranked stays in priority.ts / qa_agent_queue() — this is
// purely the rendering, parameterized by what the viewer is allowed to do
// (an Audit button, and where an agent's name links to).
// ============================================================

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' })
const fmtDay = (iso: string | null) => (iso ? dayFmt.format(new Date(iso)) : 'Never')
const fmtScore = (v: number | null) => (v === null ? '—' : `${v}%`)

export interface AgentQueueTableProps {
  ranked: RankedRow[]
  /** Re-training agents, appended below the ranked list, same as QA's queue (§7 — their target
   *  isn't a weekly number so they never join the ranking itself). Omit where not relevant. */
  reTraining?: OjtCandidate[]
  /** Where an agent's name links to — `/audits/agent/{id}/profile` for QA/Team Lead, a
   *  Manager-scoped route for a Manager viewer (who can't open that page, §9 Part 2). */
  agentProfileHref: (agentId: string) => string
  /** Shown as a trailing column when the viewer may act on a row (QA, Team Lead). Omitted
   *  entirely for a view-only viewer (Manager) rather than rendered disabled. */
  action?: { label: string; href: (agentId: string) => string }
  emptyMessage?: string
}

function TargetCell({ r }: { r: RankedRow }) {
  if (!r.hasTarget || r.finalTarget === null) {
    return <span style={{ color: 'var(--text-muted)' }} title="No target rule matches this agent's vintage and team yet — set one in Targets.">target not set</span>
  }
  const met = r.doneThisWeek >= r.finalTarget
  return (
    <span>
      <b style={{ color: met ? 'var(--status-green)' : 'inherit' }}>{r.doneThisWeek}</b> / {r.finalTarget}
      {r.bonusApplied && <span title={`+1 bonus: ${r.bonusReasons.join(', ')}`} style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--highlight)' }}>+1</span>}
      {r.targetFrozen && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>frozen</span>}
    </span>
  )
}

function Row({ r, agentProfileHref, action }: { r: RankedRow; agentProfileHref: (id: string) => string; action?: AgentQueueTableProps['action'] }) {
  const tone = r.criticalRecent || r.ryg === 'red' ? 'var(--alert)' : r.onPip || r.zeroStreak > 0 ? 'var(--highlight)' : 'var(--text-muted)'
  return (
    <tr>
      <td style={td}>{r.rank}</td>
      <td style={td}>
        <Link href={agentProfileHref(r.agentId)} style={{ color: 'inherit', textDecoration: 'none' }}>
          <b style={{ color: 'var(--brand)' }}>{r.name}</b>
        </Link>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'} · {r.stage === 'ojt' ? 'OJT' : (r.vintageLabel ?? 'vintage n/a')}</div>
        <div style={{ fontSize: '11px', color: tone, fontWeight: 600 }}>{r.topReason}</div>
      </td>
      <td style={td}><TargetCell r={r} /></td>
      <td style={td}>{fmtDay(r.lastAuditedAt)}</td>
      <td style={td}>{fmtDay(r.lastCoachedAt)}</td>
      <td style={td} title={r.lastWeekComputed ? undefined : 'Last week has not been computed yet'}>
        {r.lastWeekComputed ? formatUsd(r.lastWeekUsd) : '—'}
        {r.achievementPct !== null && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.achievementPct}% of target</div>}
      </td>
      <td style={td}>{formatUsd(r.thisWeekUsd)}</td>
      <td style={td}>{fmtScore(r.lastWeekAvgScore)}</td>
      <td style={td}>{fmtScore(r.thisWeekAvgScore)}</td>
      {action && (
        <td style={td}>
          <Link href={action.href(r.agentId)}
            style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 500, color: '#fff', background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
            {action.label}
          </Link>
        </td>
      )}
    </tr>
  )
}

// Re-training agents (Jamil, 2026-10-03): kept out of the priority ranking above — their
// "target" is a flat 1 call across a fixed 3-day window (§7), not a weekly count, so they
// don't fit the Done/Target column or the RYG-driven priority order at all — but shown at
// the BOTTOM of the same table, flagged, rather than invisible. Last Audited/Last
// Coached/Last Week/This Week are real facts (schema_068/071), not placeholders.
function ReTrainingRow({ c, rowNumber, agentProfileHref, action }: { c: OjtCandidate; rowNumber: number; agentProfileHref: (id: string) => string; action?: AgentQueueTableProps['action'] }) {
  const ended = c.reTrainingDaysLeft !== null && c.reTrainingDaysLeft <= 0
  const flagColor = ended ? 'var(--alert)' : 'var(--highlight)'
  const flagText = ended
    ? `Re-training ended ${fmtDay(c.reTrainingEndDate)} — awaiting certify/discontinue decision`
    : `Re-training — ends ${fmtDay(c.reTrainingEndDate)} (${c.reTrainingDaysLeft ?? '?'} day${c.reTrainingDaysLeft === 1 ? '' : 's'} left)`
  return (
    <tr>
      <td style={td}>{rowNumber}</td>
      <td style={td}>
        <Link href={agentProfileHref(c.agentId)} style={{ color: 'inherit', textDecoration: 'none' }}>
          <b style={{ color: 'var(--brand)' }}>{c.name}</b>
        </Link>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[c.teamName, c.siteName].filter(Boolean).join(' · ') || '—'} · OJT</div>
        <div style={{ fontSize: '11px', color: flagColor, fontWeight: 600 }}>{flagText}</div>
      </td>
      <td style={td}>
        {c.reTrainingCallDone ? <span style={{ color: 'var(--status-green)' }}>1 call done</span> : <span style={{ color: 'var(--text-muted)' }}>No call yet</span>}
      </td>
      <td style={td}>{fmtDay(c.lastAuditedAt)}</td>
      <td style={td}>{fmtDay(c.lastCoachedAt)}</td>
      <td style={td} title={c.lastWeekComputed ? undefined : 'Last week has not been computed yet'}>
        {c.lastWeekComputed ? formatUsd(c.lastWeekUsd) : '—'}
      </td>
      <td style={td}>{formatUsd(c.thisWeekUsd)}</td>
      <td style={td}>{fmtScore(c.lastWeekAvgScore)}</td>
      <td style={td}>{fmtScore(c.thisWeekAvgScore)}</td>
      {action && (
        <td style={td}>
          <Link href={action.href(c.agentId)}
            style={{ padding: '6px 14px', fontSize: '13px', fontWeight: 500, color: '#fff', background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
            {action.label}
          </Link>
        </td>
      )}
    </tr>
  )
}

export function AgentQueueTable({ ranked, reTraining = [], agentProfileHref, action, emptyMessage = 'No agents to show.' }: AgentQueueTableProps) {
  if (ranked.length === 0 && reTraining.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{emptyMessage}</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
        <thead>
          <tr>
            <th style={th}>#</th><th style={th}>Agent</th><th style={th}>Done / target</th><th style={th}>Last audited</th>
            <th style={th}>Last coached</th><th style={th}>Last week ($)</th><th style={th}>This week ($)</th>
            <th style={th}>Last week (score)</th><th style={th}>This week (score)</th>{action && <th style={th} />}
          </tr>
        </thead>
        <tbody>
          {ranked.map((r) => <Row key={r.agentId} r={r} agentProfileHref={agentProfileHref} action={action} />)}
          {reTraining.map((c, i) => <ReTrainingRow key={c.agentId} c={c} rowNumber={ranked.length + i + 1} agentProfileHref={agentProfileHref} action={action} />)}
        </tbody>
      </table>
    </div>
  )
}
