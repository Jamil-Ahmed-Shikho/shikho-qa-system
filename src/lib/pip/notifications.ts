// ============================================================
// SHIKHO QA SYSTEM — PIP publish notifications, the rules (§6.4, Section C, Stage 7)
// Pure: no database, no email. Decides WHO gets notified and WHAT is in it, on a
// PUBLISHED cycle's approved candidates.
//
//   Agent      -> their own period/target/achievement/downgrade note (Stage 6's own content)
//   Team Lead  -> the NAMES of their own published agents only (never the full list)
//   Manager    -> the same, across their chain, grouped by Team Lead
//
// A candidate is always an agent one hop from their Team Lead and one hop from that
// Team Lead's Manager in this system's data model (no team_lead ever reports to another
// team_lead, §2) — so unlike the Briefings digest's generic recursive chain walk
// (scopeAgentIds, needed because a Manager's OWN whole roster is in scope), this only
// ever needs to look at the specific Team Leads/Managers of the agents actually
// published in THIS cycle, not the whole org chart.
//
// Who can RECEIVE at all — same principle as the Briefings digest (§5 Part C): an
// active account with a real login (account_status 'active'). A profile-only person
// hasn't been invited to the system yet, so a PIP notice (agent) or a "these of your
// people are on PIP" summary (Team Lead/Manager) isn't sent to them.
// ============================================================

export interface NotifyAgent {
  id: string
  name: string
  email: string
  isActive: boolean
  accountStatus: string | null
  teamLeaderId: string | null
  targetRevenue: number | null
  incentiveDowngraded: boolean
}

export interface NotifyStaff {
  id: string
  name: string
  email: string
  role: 'team_lead' | 'manager'
  isActive: boolean
  accountStatus: string | null
  /** Only meaningful on a team_lead row — who their Manager is. */
  managerId: string | null
}

export function canReceivePipNotification(u: { isActive: boolean; accountStatus: string | null; email: string | null | undefined }): boolean {
  return u.isActive && u.accountStatus === 'active' && typeof u.email === 'string' && u.email.includes('@')
}

export interface AgentNotification {
  recipient: { id: string; name: string; email: string }
  targetRevenue: number | null
  incentiveDowngraded: boolean
}

/** One per eligible published agent. */
export function buildAgentNotifications(agents: NotifyAgent[]): AgentNotification[] {
  return agents
    .filter(canReceivePipNotification)
    .map((a) => ({
      recipient: { id: a.id, name: a.name, email: a.email },
      targetRevenue: a.targetRevenue,
      incentiveDowngraded: a.incentiveDowngraded,
    }))
    .sort((a, b) => a.recipient.name.localeCompare(b.recipient.name))
}

export interface StaffGroup {
  /** The Team Lead's name, for a Manager's email (one group per Team Lead); null for a Team Lead's own. */
  teamLeadName: string | null
  agentNames: string[]
}

export interface StaffNotification {
  recipient: { id: string; name: string; email: string; role: 'team_lead' | 'manager' }
  groups: StaffGroup[]
  total: number
}

/**
 * One per eligible Team Lead / Manager who has at least one of their own agents on the
 * published list. Everyone else (nobody of theirs published) gets nothing — never an
 * empty "none of your people" email.
 */
export function buildStaffNotifications(agents: NotifyAgent[], teamLeads: NotifyStaff[], managers: NotifyStaff[]): StaffNotification[] {
  const byTeamLead = new Map<string, NotifyAgent[]>()
  for (const a of agents) {
    if (!a.teamLeaderId) continue
    byTeamLead.set(a.teamLeaderId, [...(byTeamLead.get(a.teamLeaderId) ?? []), a])
  }

  const out: StaffNotification[] = []
  for (const tl of teamLeads) {
    const mine = byTeamLead.get(tl.id) ?? []
    if (mine.length === 0 || !canReceivePipNotification(tl)) continue
    out.push({
      recipient: { id: tl.id, name: tl.name, email: tl.email, role: 'team_lead' },
      groups: [{ teamLeadName: null, agentNames: mine.map((a) => a.name).sort() }],
      total: mine.length,
    })
  }
  for (const mgr of managers) {
    const myTeamLeads = teamLeads.filter((tl) => tl.managerId === mgr.id)
    const groups = myTeamLeads
      .map((tl) => ({ teamLeadName: tl.name, agentNames: (byTeamLead.get(tl.id) ?? []).map((a) => a.name).sort() }))
      .filter((g) => g.agentNames.length > 0)
      .sort((a, b) => (a.teamLeadName ?? '').localeCompare(b.teamLeadName ?? ''))
    const total = groups.reduce((sum, g) => sum + g.agentNames.length, 0)
    if (total === 0 || !canReceivePipNotification(mgr)) continue
    out.push({ recipient: { id: mgr.id, name: mgr.name, email: mgr.email, role: 'manager' }, groups, total })
  }
  return out.sort((a, b) => a.recipient.name.localeCompare(b.recipient.name))
}
