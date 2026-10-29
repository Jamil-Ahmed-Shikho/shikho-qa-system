// ============================================================
// SHIKHO QA SYSTEM — "By QA Auditor" agent-wise breakdown, for QA
// Manager / Super Admin (and a QA Auditor's own Team View) on This
// Week's QA Progress. Pure module, no server imports.
//
// Jamil, 2026-10-29: a Manager can already drill "By Team Lead" into
// agent-wise data (rollup.ts), and a QA Auditor already sees their own
// agent-wise queue — but QA Manager/Super Admin had no equivalent way to
// see "this auditor's agents, in the same shape". This groups the exact
// same qa_agent_queue()/ojt_candidates() rows everyone else's queue
// already uses (schema_103 denormalizes quality_auditor_id/name onto
// both), ranked the identical way (priority.ts) — never a separate
// calculation, so it can't disagree with what the auditor's own queue
// shows.
// ============================================================

import { rankQueue, type QueueRow, type RankedRow } from '../queue/priority'
import type { OjtCandidate } from '../ojt/ojt.service'

export const UNASSIGNED_AUDITOR_ID = '__unassigned__'

export interface AuditorAgentGroup {
  auditorId: string
  auditorName: string
  rankedAgents: RankedRow[]
  reTraining: OjtCandidate[]
}

/** Groups the already-fetched queue + re-training rows by their assigned QA Auditor
 *  (quality_auditor_id) — sorted by name, with an "Unassigned" group (agents nobody's
 *  portfolio owns yet) appended last, same placement rollup.ts gives its own "Other agents"
 *  fallback group. */
export function groupQueueByAuditor(rows: QueueRow[], reTrainingRows: OjtCandidate[]): AuditorAgentGroup[] {
  const byAuditor = new Map<string, { name: string; agents: QueueRow[] }>()
  for (const r of rows) {
    const key = r.qualityAuditorId ?? UNASSIGNED_AUDITOR_ID
    const name = r.qualityAuditorId ? (r.qualityAuditorName ?? 'Unknown') : 'Unassigned'
    const entry = byAuditor.get(key) ?? { name, agents: [] }
    entry.agents.push(r)
    byAuditor.set(key, entry)
  }

  const byAuditorReTraining = new Map<string, OjtCandidate[]>()
  for (const c of reTrainingRows) {
    if (c.stage !== 're_training') continue
    const key = c.qualityAuditorId ?? UNASSIGNED_AUDITOR_ID
    const list = byAuditorReTraining.get(key) ?? []
    list.push(c)
    byAuditorReTraining.set(key, list)
    if (!byAuditor.has(key)) byAuditor.set(key, { name: c.qualityAuditorId ? (c.qualityAuditorName ?? 'Unknown') : 'Unassigned', agents: [] })
  }

  const byReTrainingName = (a: OjtCandidate, b: OjtCandidate) => a.name.localeCompare(b.name)

  const groups: AuditorAgentGroup[] = [...byAuditor.entries()]
    .filter(([key]) => key !== UNASSIGNED_AUDITOR_ID)
    .map(([auditorId, { name, agents }]) => ({
      auditorId,
      auditorName: name,
      rankedAgents: rankQueue(agents),
      reTraining: (byAuditorReTraining.get(auditorId) ?? []).sort(byReTrainingName),
    }))
    .sort((a, b) => a.auditorName.localeCompare(b.auditorName))

  const unassigned = byAuditor.get(UNASSIGNED_AUDITOR_ID)
  if (unassigned && (unassigned.agents.length > 0 || (byAuditorReTraining.get(UNASSIGNED_AUDITOR_ID)?.length ?? 0) > 0)) {
    groups.push({
      auditorId: UNASSIGNED_AUDITOR_ID,
      auditorName: 'Unassigned',
      rankedAgents: rankQueue(unassigned.agents),
      reTraining: (byAuditorReTraining.get(UNASSIGNED_AUDITOR_ID) ?? []).sort(byReTrainingName),
    })
  }

  return groups
}
