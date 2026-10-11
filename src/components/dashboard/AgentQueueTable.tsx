import Link from 'next/link'
import { formatUsd } from '@/lib/money/usd'
import type { RankedRow } from '@/lib/queue/priority'
import type { OjtCandidate } from '@/lib/ojt/ojt.service'
import { StatusChip, type ChipTone } from '@/components/common/StatusChip'

// ============================================================
// The priority-ranked agent table QA's "Who to audit next" (QueueSection)
// originated — extracted 2026-10-04 so Team Lead and Manager dashboards can
// show the SAME view (Jamil's own request: "same view like Auditor will be
// good enough... with all QA, TL, Manager view"), instead of each having a
// thinner, differently-shaped table. Everything about WHAT the columns mean
// and HOW rows are ranked stays in priority.ts / qa_agent_queue() — this is
// purely the rendering, parameterized by what the viewer is allowed to do
// (an Audit button, and where an agent's name links to).
//
// Mobile card view + status chips added 2026-10-12 (Team Lead portal
// standardization) — both apply here, in the shared component, rather than
// in a TL-only copy, so QA Auditor's and Manager's dashboards get the same
// readability improvement on a narrow screen without being asked twice.
// ============================================================

const BREAKPOINT = 768
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' })
const fmtDay = (iso: string | null) => (iso ? dayFmt.format(new Date(iso)) : 'Never')
const fmtScore = (v: number | null) => (v === null ? '—' : `${v}%`)

/** Which chip tone a ranked row's top-priority reason deserves — a finer-grained read than the old
 *  flat two-color scheme: Yellow now reads as a warning (not neutral), Green as a quiet success,
 *  so the chip's color actually tracks the agent's real standing, not just "flagged or not". */
function reasonTone(r: Pick<RankedRow, 'criticalRecent' | 'onPip' | 'zeroStreak' | 'ryg'>): ChipTone {
  if (r.criticalRecent || r.ryg === 'red') return 'alert'
  if (r.onPip || r.zeroStreak > 0 || r.ryg === 'yellow') return 'warning'
  if (r.ryg === 'green') return 'success'
  return 'neutral'
}

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

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ display: 'inline-block', padding: '6px 14px', fontSize: '13px', fontWeight: 500, color: '#fff', background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
      {label}
    </Link>
  )
}

function Row({ r, agentProfileHref, action }: { r: RankedRow; agentProfileHref: (id: string) => string; action?: AgentQueueTableProps['action'] }) {
  return (
    <tr>
      <td style={td}>{r.rank}</td>
      <td style={td}>
        <Link href={agentProfileHref(r.agentId)} style={{ color: 'inherit', textDecoration: 'none' }}>
          <b style={{ color: 'var(--brand)' }}>{r.name}</b>
        </Link>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'} · {r.stage === 'ojt' ? 'OJT' : (r.vintageLabel ?? 'vintage n/a')}</div>
        <div style={{ marginTop: '4px' }}><StatusChip tone={reasonTone(r)}>{r.topReason}</StatusChip></div>
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
      {action && <td style={td}><ActionButton href={action.href(r.agentId)} label={action.label} /></td>}
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
        <div style={{ marginTop: '4px' }}><StatusChip tone={ended ? 'alert' : 'warning'}>{flagText}</StatusChip></div>
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
      {action && <td style={td}><ActionButton href={action.href(c.agentId)} label={action.label} /></td>}
    </tr>
  )
}

// ── Mobile card view (<768px) — same facts as a table row, stacked ───────────────────────────────

const cardStyle: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: '10px', background: 'var(--surface-2)' }
const miniGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', margin: '10px 0' }
const miniLabel: React.CSSProperties = { fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }
const miniValue: React.CSSProperties = { fontSize: '13px', fontWeight: 600 }

function Card({ r, agentProfileHref, action }: { r: RankedRow; agentProfileHref: (id: string) => string; action?: AgentQueueTableProps['action'] }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <Link href={agentProfileHref(r.agentId)} style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>{r.name}</Link>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'} · {r.stage === 'ojt' ? 'OJT' : (r.vintageLabel ?? 'vintage n/a')}</div>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>#{r.rank}</span>
      </div>
      <div style={{ marginTop: '6px' }}><StatusChip tone={reasonTone(r)}>{r.topReason}</StatusChip></div>
      <div style={miniGrid}>
        <div><div style={miniLabel}>Done / target</div><div style={miniValue}><TargetCell r={r} /></div></div>
        <div><div style={miniLabel}>Last audited</div><div style={miniValue}>{fmtDay(r.lastAuditedAt)}</div></div>
        <div><div style={miniLabel}>Last week ($)</div><div style={miniValue}>{r.lastWeekComputed ? formatUsd(r.lastWeekUsd) : '—'}</div></div>
        <div><div style={miniLabel}>This week ($)</div><div style={miniValue}>{formatUsd(r.thisWeekUsd)}</div></div>
        <div><div style={miniLabel}>Last week score</div><div style={miniValue}>{fmtScore(r.lastWeekAvgScore)}</div></div>
        <div><div style={miniLabel}>This week score</div><div style={miniValue}>{fmtScore(r.thisWeekAvgScore)}</div></div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: action ? '10px' : 0 }}>Last coached: {fmtDay(r.lastCoachedAt)}</div>
      {action && <ActionButton href={action.href(r.agentId)} label={action.label} />}
    </div>
  )
}

function ReTrainingCard({ c, rowNumber, agentProfileHref, action }: { c: OjtCandidate; rowNumber: number; agentProfileHref: (id: string) => string; action?: AgentQueueTableProps['action'] }) {
  const ended = c.reTrainingDaysLeft !== null && c.reTrainingDaysLeft <= 0
  const flagText = ended
    ? `Re-training ended ${fmtDay(c.reTrainingEndDate)} — awaiting certify/discontinue decision`
    : `Re-training — ends ${fmtDay(c.reTrainingEndDate)} (${c.reTrainingDaysLeft ?? '?'} day${c.reTrainingDaysLeft === 1 ? '' : 's'} left)`
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <Link href={agentProfileHref(c.agentId)} style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>{c.name}</Link>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[c.teamName, c.siteName].filter(Boolean).join(' · ') || '—'} · OJT</div>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>#{rowNumber}</span>
      </div>
      <div style={{ marginTop: '6px' }}><StatusChip tone={ended ? 'alert' : 'warning'}>{flagText}</StatusChip></div>
      <div style={miniGrid}>
        <div><div style={miniLabel}>Re-training call</div><div style={miniValue}>{c.reTrainingCallDone ? '1 call done' : 'No call yet'}</div></div>
        <div><div style={miniLabel}>Last audited</div><div style={miniValue}>{fmtDay(c.lastAuditedAt)}</div></div>
        <div><div style={miniLabel}>Last week ($)</div><div style={miniValue}>{c.lastWeekComputed ? formatUsd(c.lastWeekUsd) : '—'}</div></div>
        <div><div style={miniLabel}>This week ($)</div><div style={miniValue}>{formatUsd(c.thisWeekUsd)}</div></div>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: action ? '10px' : 0 }}>Last coached: {fmtDay(c.lastCoachedAt)}</div>
      {action && <ActionButton href={action.href(c.agentId)} label={action.label} />}
    </div>
  )
}

export function AgentQueueTable({ ranked, reTraining = [], agentProfileHref, action, emptyMessage = 'No agents to show.' }: AgentQueueTableProps) {
  if (ranked.length === 0 && reTraining.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{emptyMessage}</p>
  }
  return (
    <div>
      <style>{`
        .aqt-table-view { display: block; }
        .aqt-card-view { display: none; }
        @media (max-width: ${BREAKPOINT}px) {
          .aqt-table-view { display: none; }
          .aqt-card-view { display: block; }
        }
      `}</style>

      <div className="aqt-table-view" style={{ overflowX: 'auto' }}>
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

      <div className="aqt-card-view">
        {ranked.map((r) => <Card key={r.agentId} r={r} agentProfileHref={agentProfileHref} action={action} />)}
        {reTraining.map((c, i) => <ReTrainingCard key={c.agentId} c={c} rowNumber={ranked.length + i + 1} agentProfileHref={agentProfileHref} action={action} />)}
      </div>
    </div>
  )
}
