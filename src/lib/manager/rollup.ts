// ============================================================
// SHIKHO QA SYSTEM — Manager dashboard rollup
// Pure module. Takes the per-agent rows from manager_agent_stats()
// (schema_007) and the manager's Team Leads, and produces the overall
// and per-Team-Lead numbers. Every figure derives from the same agent
// rows, so the Team Lead rows always add up to the overview.
// ============================================================

export interface TeamLeadInfo {
  id: string
  name: string
  email: string
  team_name: string | null
  site_name: string | null
  is_active: boolean
}

export interface AgentStatRow {
  agent_id: string
  agent_name: string
  agent_email: string
  team_name: string | null
  site_name: string | null
  employment_stage: string
  is_active: boolean
  team_leader_id: string | null
  audits_completed: number
  score_sum: number
  audits_passed: number
  critical_fails: number
}

export interface Metrics {
  /** Current agents (active account, in OJT / re-training / active). */
  agents: number
  /** Current agents with at least one audit in the period. */
  audited_agents: number
  audits: number
  avg_score: number | null
  pass_rate: number | null
  critical_fails: number
  /** audited_agents / agents, as a percentage. */
  coverage: number | null
}

export interface TeamLeadGroup {
  /** null = agents whose Team Lead isn't one of this manager's direct reports. */
  teamLead: TeamLeadInfo | null
  agents: AgentStatRow[]
  metrics: Metrics
}

export interface ManagerRollup {
  overview: Metrics
  activeTeamLeads: number
  groups: TeamLeadGroup[]
}

const CURRENT_STAGES = ['ojt', 're_training', 'active']

function isCurrentAgent(a: AgentStatRow): boolean {
  return a.is_active && CURRENT_STAGES.includes(a.employment_stage)
}

export function computeMetrics(agents: AgentStatRow[]): Metrics {
  const current = agents.filter(isCurrentAgent)
  const audits = agents.reduce((s, a) => s + a.audits_completed, 0)
  const scoreSum = agents.reduce((s, a) => s + a.score_sum, 0)
  const passed = agents.reduce((s, a) => s + a.audits_passed, 0)
  const audited = current.filter((a) => a.audits_completed > 0).length

  return {
    agents: current.length,
    audited_agents: audited,
    audits,
    avg_score: audits > 0 ? scoreSum / audits : null,
    pass_rate: audits > 0 ? (passed / audits) * 100 : null,
    critical_fails: agents.reduce((s, a) => s + a.critical_fails, 0),
    coverage: current.length > 0 ? (audited / current.length) * 100 : null,
  }
}

export function buildRollup(teamLeads: TeamLeadInfo[], rows: AgentStatRow[]): ManagerRollup {
  // Deactivated / discontinued agents only appear if they were audited
  // in the period (so historical numbers still reconcile).
  const visible = rows.filter((a) => isCurrentAgent(a) || a.audits_completed > 0)

  const byTeamLead = new Map<string, AgentStatRow[]>()
  const knownTeamLeads = new Set(teamLeads.map((t) => t.id))
  const other: AgentStatRow[] = []
  for (const agent of visible) {
    if (agent.team_leader_id && knownTeamLeads.has(agent.team_leader_id)) {
      const list = byTeamLead.get(agent.team_leader_id) ?? []
      list.push(agent)
      byTeamLead.set(agent.team_leader_id, list)
    } else {
      other.push(agent)
    }
  }

  const byName = (a: AgentStatRow, b: AgentStatRow) => a.agent_name.localeCompare(b.agent_name)

  const groups: TeamLeadGroup[] = teamLeads
    .map((tl) => ({ tl, agents: (byTeamLead.get(tl.id) ?? []).sort(byName) }))
    // A deactivated Team Lead only shows if agents still hang off them.
    .filter(({ tl, agents }) => tl.is_active || agents.length > 0)
    .sort((a, b) => a.tl.name.localeCompare(b.tl.name))
    .map(({ tl, agents }) => ({ teamLead: tl, agents, metrics: computeMetrics(agents) }))

  if (other.length > 0) {
    other.sort(byName)
    groups.push({ teamLead: null, agents: other, metrics: computeMetrics(other) })
  }

  return {
    overview: computeMetrics(visible),
    activeTeamLeads: teamLeads.filter((t) => t.is_active).length,
    groups,
  }
}
