// ============================================================
// SHIKHO QA SYSTEM — Sampling queue: priority order + target summary (§9.3)
// Pure (no server imports), unit-tested. The database returns FACTS per agent
// (qa_agent_queue, schema_034); the ORDER lives here so it can be tested and
// read in one place.
//
// Confirmed tier order (§9.3), applied strictly top to bottom:
//   1. critical fatal error in the trailing period      — unconditionally first
//   2. active PIP                                        — above non-PIP
//   3. zero-seller streak, longest first
//   4. RYG: Red, then Yellow, then Green
//   5. revenue achievement % (last completed week's revenue / that week's target), lowest first
// ASSUMPTION (not specified — flagged in docs/questions): an agent with NO RYG status yet (no audit in the window)
// ranks right after Red and before Yellow — someone nobody has audited recently should not sink to the bottom.
// Agents with no achievement figure (no target set, or no revenue data for last week) sort after those with one.
// ============================================================

export interface QueueRow {
  agentId: string
  name: string
  email: string | null
  teamName: string | null
  siteName: string | null
  stage: string
  vintageLabel: string | null
  /** Carried through so a Manager caller (whose scope spans several Team Leads) can group rows
   *  client-side, the same way manager_agent_stats() rows already do (rollup.ts). */
  teamLeaderId: string | null
  hasTarget: boolean
  baseTarget: number | null
  bonusApplied: boolean
  bonusReasons: string[]
  finalTarget: number | null
  targetFrozen: boolean
  doneThisWeek: number
  lastAuditedAt: string | null
  lastCoachedAt: string | null
  lastWeekUsd: number | null
  thisWeekUsd: number | null
  lastWeekComputed: boolean
  lastWeekRevenueTargetUsd: number | null
  /** Average score_percent over submitted audits in that sales week — null when there were none. */
  lastWeekAvgScore: number | null
  thisWeekAvgScore: number | null
  /** 'unrated' (schema_037, Q5): an eligible agent with no audit in the RYG window — a distinct neutral status,
   *  never a colour. null means no RYG row at all (an OJT/re-training agent — RYG never applies to them, Q7 —
   *  or the status job simply hasn't run yet for a new active agent). */
  ryg: 'red' | 'yellow' | 'green' | 'unrated' | null
  criticalRecent: boolean
  onPip: boolean
  zeroStreak: number
}

export type Tier = 'critical' | 'pip' | 'zero_seller' | 'ryg' | 'revenue'

export interface RankedRow extends QueueRow {
  rank: number
  /** Revenue achievement % for the last completed week, or null when it can't be worked out. */
  achievementPct: number | null
  /** The highest-priority reason this agent is where they are, for the badge. */
  topReason: string
}

// 'unrated' and no-row-at-all (null) sort in the same slot as Red-adjacent "not enough to judge yet",
// right after Red and before Yellow — an agent nobody has scored recently should not sink to the bottom.
const RYG_ORDER: Record<string, number> = { red: 0, none: 1, unrated: 1, yellow: 2, green: 3 }

export function achievementPct(r: Pick<QueueRow, 'lastWeekUsd' | 'lastWeekRevenueTargetUsd' | 'lastWeekComputed'>): number | null {
  if (!r.lastWeekComputed || r.lastWeekUsd === null || r.lastWeekRevenueTargetUsd === null || r.lastWeekRevenueTargetUsd <= 0) return null
  return Math.round((r.lastWeekUsd / r.lastWeekRevenueTargetUsd) * 1000) / 10
}

function reason(r: QueueRow): string {
  if (r.criticalRecent) return 'Critical fatal error'
  if (r.onPip) return 'On a PIP'
  if (r.zeroStreak > 0) return `Zero-seller ${r.zeroStreak} week${r.zeroStreak === 1 ? '' : 's'}`
  if (r.ryg === 'red') return 'Red'
  if (r.ryg === 'unrated') return 'Unrated — no audits yet'
  if (r.ryg === null) return 'No recent audits'
  if (r.ryg === 'yellow') return 'Yellow'
  return 'Green'
}

export function rankQueue(rows: QueueRow[]): RankedRow[] {
  const withAch = rows.map((r) => ({ r, ach: achievementPct(r) }))
  withAch.sort((a, b) => {
    if (a.r.criticalRecent !== b.r.criticalRecent) return a.r.criticalRecent ? -1 : 1
    if (a.r.onPip !== b.r.onPip) return a.r.onPip ? -1 : 1
    if (a.r.zeroStreak !== b.r.zeroStreak) return b.r.zeroStreak - a.r.zeroStreak
    const ra = RYG_ORDER[a.r.ryg ?? 'none'], rb = RYG_ORDER[b.r.ryg ?? 'none']
    if (ra !== rb) return ra - rb
    if (a.ach !== b.ach) {
      if (a.ach === null) return 1
      if (b.ach === null) return -1
      return a.ach - b.ach
    }
    return a.r.name.localeCompare(b.r.name)
  })
  return withAch.map((x, i) => ({ ...x.r, rank: i + 1, achievementPct: x.ach, topReason: reason(x.r) }))
}

// ── Target summary (by team/channel, with OJT as its own group) ──

export interface GroupSummary {
  group: string
  agents: number
  target: number
  done: number
  /** agents in the group with no target rule yet */
  withoutTarget: number
}

export function groupKey(r: Pick<QueueRow, 'stage' | 'teamName'>): string {
  return r.stage === 'ojt' ? 'OJT' : (r.teamName ?? 'No team')
}

export function summarizeTargets(rows: QueueRow[]): { total: GroupSummary; groups: GroupSummary[] } {
  const map = new Map<string, GroupSummary>()
  for (const r of rows) {
    const k = groupKey(r)
    const g = map.get(k) ?? { group: k, agents: 0, target: 0, done: 0, withoutTarget: 0 }
    g.agents += 1
    g.done += r.doneThisWeek
    if (r.hasTarget && r.finalTarget !== null) g.target += r.finalTarget
    else g.withoutTarget += 1
    map.set(k, g)
  }
  const groups = [...map.values()].sort((a, b) => (a.group === 'OJT' ? 1 : b.group === 'OJT' ? -1 : a.group.localeCompare(b.group)))
  const total = groups.reduce<GroupSummary>(
    (t, g) => ({ group: 'Total', agents: t.agents + g.agents, target: t.target + g.target, done: t.done + g.done, withoutTarget: t.withoutTarget + g.withoutTarget }),
    { group: 'Total', agents: 0, target: 0, done: 0, withoutTarget: 0 }
  )
  return { total, groups }
}
