// ============================================================
// Replaces the old "Agent RYG & Vintage" card (2026-10-04, Jamil's own
// request: rename the section and show the same richer, priority-ranked
// view QA's "Who to audit next" already has — "i suggest same view like
// Auditor will be good enough"). Reuses qa_agent_queue() (schema_070,
// extended with team_lead scoping) and the exact same AgentQueueTable /
// rankQueue() QA's own queue uses — a Team Lead gets the identical columns
// (Done/Target, Last Audited, Last Coached, Last Week/This Week revenue
// AND average score) plus the same priority ordering (critical fatal → PIP
// → zero-seller → RYG → revenue achievement), since it's exactly as useful
// for deciding who on their own team to audit next as it is for QA.
//
// A Team Lead has no My View/Team View toggle (§2's own rule — their
// scoping is always the one view), so p_view is passed but ignored by the
// database for this role.
// ============================================================

import { isMissingTargetsSchema, loadQueue } from '@/lib/queue/queue.service'
import { rankQueue, type QueueRow } from '@/lib/queue/priority'
import { loadOjtCandidates, isMissingOjtSchema, type OjtCandidate } from '@/lib/ojt/ojt.service'
import { AgentQueueTable } from '../AgentQueueTable'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }

export async function TeamLeadAgentPerformanceSection() {
  let rows: QueueRow[] = []
  let failed = false
  try {
    rows = await loadQueue('team')
  } catch (err) {
    failed = true
    if (!isMissingTargetsSchema(err)) console.error('TeamLeadAgentPerformanceSection loadQueue failed:', err)
  }

  let reTraining: OjtCandidate[] = []
  try {
    reTraining = (await loadOjtCandidates('team')).filter((c) => c.stage === 're_training')
  } catch (err) {
    if (!isMissingOjtSchema(err)) console.error('TeamLeadAgentPerformanceSection loadOjtCandidates failed:', err)
  }

  return (
    <div style={card}>
      <h2 style={sectionTitle}>Academic Counselor Performance</h2>
      <p style={sectionNote}>
        Your team, ranked the same way QA&apos;s own queue is: critical fatal error first, then PIP, longest zero-seller streak, Red before Yellow before Green, then lowest revenue achievement.
      </p>
      {failed ? (
        <p role="alert" style={{ color: 'var(--alert)', fontSize: '13px', margin: 0 }}>Could not be loaded right now — this does not mean your team is empty.</p>
      ) : (
        <AgentQueueTable
          ranked={rankQueue(rows)}
          reTraining={reTraining}
          agentProfileHref={(id) => `/audits/agent/${encodeURIComponent(id)}/profile`}
          action={{ label: 'Audit', href: (id) => `/audits/agent/${encodeURIComponent(id)}` }}
          emptyMessage="No agents on your team yet."
        />
      )}
    </div>
  )
}
