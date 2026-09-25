// ============================================================
// SHIKHO QA SYSTEM — Briefings daily digest, the rules (§5, Part C)
// Pure: no database, no email. Decides WHO gets a digest and WHAT is in it.
//
// Each Team Lead and each Manager gets ONE email compiling tomorrow's
// coaching sessions for THEIR OWN people only:
//   Team Lead -> agents whose team_leader_id is them (team_agent_ids(), schema_008)
//   Manager   -> the agents of every Team Lead who reports to them
//                (manager_chain_ids(), schema_007)
// Never company-wide. Anyone with nobody briefed tomorrow gets NOTHING
// (no empty digest). `scopeAgentIds()` re-states those two database rules
// in TypeScript; a randomized parity test (scratchpad test-digest-parity)
// keeps it identical to the SQL — change one, change the other.
//
// Who is eligible to RECEIVE: active accounts (is_active) whose login has
// actually been created (account_status 'active'). A profile-only person
// hasn't been invited to the system yet (§2) — telling them about it as a
// side effect of a cron job is exactly the kind of surprise §2 avoids.
// ============================================================

import { SLOT_MINUTES, dhakaMidnight, formatSlotDay, formatSlotTime } from './rules'

const DAY_MS = 24 * 60 * 60 * 1000
const BD_OFFSET_MS = 6 * 60 * 60 * 1000

export interface DigestUser {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  account_status: string | null
  team_leader_id: string | null
  manager_id: string | null
}

export interface DigestSession {
  briefingId: string
  agentId: string
  scheduledAt: string
  conductorName: string | null
  urgent: boolean
}

export interface DigestRow {
  briefingId: string
  agentName: string
  time: string
  scheduledAt: string
  conductorName: string | null
  urgent: boolean
}

export interface DigestGroup {
  /** The Team Lead's name for a Manager's digest (one group per Team Lead); null for a Team Lead's own. */
  label: string | null
  rows: DigestRow[]
}

export interface Digest {
  recipient: { id: string; name: string; email: string; role: 'team_lead' | 'manager' }
  /** 'YYYY-MM-DD', the Dhaka day the sessions are on. */
  ymd: string
  /** "Sun 27 Sept" */
  dayLabel: string
  total: number
  groups: DigestGroup[]
}

export interface TargetDay {
  dayStart: Date
  dayEnd: Date
  ymd: string
  dayLabel: string
}

/**
 * The Dhaka day the digest is ABOUT. The job is scheduled for 23:00 Dhaka, so
 * that is "tomorrow". Vercel Hobby crons can fire anywhere inside the hour
 * (and a retry could land later), so a run in the small hours — before noon,
 * Dhaka — is treated as the digest for the day that has just begun rather
 * than skipping a whole day.
 */
export function targetDay(now: Date = new Date()): TargetDay {
  const dhakaHour = new Date(now.getTime() + BD_OFFSET_MS).getUTCHours()
  const todayStart = dhakaMidnight(now)
  const dayStart = dhakaHour >= 12 ? new Date(todayStart.getTime() + DAY_MS) : todayStart
  return {
    dayStart,
    dayEnd: new Date(dayStart.getTime() + DAY_MS),
    ymd: new Date(dayStart.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10),
    dayLabel: formatSlotDay(dayStart),
  }
}

/** Can this person receive a digest at all? Active account, real login, has an email. */
export function canReceiveDigest(u: DigestUser): boolean {
  return (
    u.is_active &&
    (u.role === 'team_lead' || u.role === 'manager') &&
    u.account_status === 'active' &&
    typeof u.email === 'string' &&
    u.email.includes('@')
  )
}

/**
 * The agents a recipient is responsible for — the SAME rule as the database:
 *  - Team Lead: role='agent' with team_leader_id = them (team_agent_ids()).
 *  - Manager: Team Leads with manager_id = them, plus everyone whose
 *    team_leader_id is already in that set, walked recursively
 *    (manager_chain_ids()); only role='agent' rows can have a briefing.
 */
export function scopeAgentIds(recipient: Pick<DigestUser, 'id' | 'role'>, users: DigestUser[]): Set<string> {
  if (recipient.role === 'team_lead') {
    return new Set(users.filter((u) => u.role === 'agent' && u.team_leader_id === recipient.id).map((u) => u.id))
  }
  if (recipient.role === 'manager') {
    const chain = new Set(users.filter((u) => u.role === 'team_lead' && u.manager_id === recipient.id).map((u) => u.id))
    let grew = true
    while (grew) {
      grew = false
      for (const u of users) {
        if (!chain.has(u.id) && u.team_leader_id !== null && chain.has(u.team_leader_id)) {
          chain.add(u.id)
          grew = true
        }
      }
    }
    const byId = new Map(users.map((u) => [u.id, u]))
    return new Set([...chain].filter((id) => byId.get(id)?.role === 'agent'))
  }
  return new Set()
}

/**
 * One digest per eligible recipient who has at least one session tomorrow in
 * their own scope. Everyone else is simply absent from the result (nothing to
 * send). `sessions` may contain other days; only those inside `day` count.
 */
export function buildDigests(users: DigestUser[], sessions: DigestSession[], day: TargetDay): Digest[] {
  const byId = new Map(users.map((u) => [u.id, u]))
  const inDay = sessions.filter((s) => {
    const t = new Date(s.scheduledAt).getTime()
    return t >= day.dayStart.getTime() && t < day.dayEnd.getTime()
  })
  // A leaver (deactivated agent) won't attend — don't tell their Team Lead to expect them.
  const live = inDay.filter((s) => {
    const a = byId.get(s.agentId)
    return !!a && a.role === 'agent' && a.is_active
  })

  const digests: Digest[] = []
  for (const r of users) {
    if (!canReceiveDigest(r)) continue
    const scope = scopeAgentIds(r, users)
    const mine = live.filter((s) => scope.has(s.agentId))
    if (mine.length === 0) continue

    const toRow = (s: DigestSession): DigestRow => ({
      briefingId: s.briefingId,
      agentName: byId.get(s.agentId)!.name,
      time: formatSlotTime(new Date(s.scheduledAt)),
      scheduledAt: s.scheduledAt,
      conductorName: s.conductorName,
      urgent: s.urgent,
    })
    const order = (a: DigestRow, b: DigestRow) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.agentName.localeCompare(b.agentName)

    let groups: DigestGroup[]
    if (r.role === 'team_lead') {
      groups = [{ label: null, rows: mine.map(toRow).sort(order) }]
    } else {
      // A Manager sees their chain grouped by Team Lead, in Team Lead name order.
      const perLead = new Map<string, DigestSession[]>()
      for (const s of mine) {
        const lead = byId.get(byId.get(s.agentId)!.team_leader_id ?? '')
        const key = lead?.name ?? '(no Team Leader)'
        perLead.set(key, [...(perLead.get(key) ?? []), s])
      }
      groups = [...perLead.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, ss]) => ({ label, rows: ss.map(toRow).sort(order) }))
    }

    digests.push({
      recipient: { id: r.id, name: r.name, email: r.email, role: r.role as 'team_lead' | 'manager' },
      ymd: day.ymd,
      dayLabel: day.dayLabel,
      total: mine.length,
      groups,
    })
  }
  return digests.sort((a, b) => a.recipient.name.localeCompare(b.recipient.name))
}

/** Re-exported so callers describe a session's length without importing rules.ts too. */
export const DIGEST_SLOT_MINUTES = SLOT_MINUTES
