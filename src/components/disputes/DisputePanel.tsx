import { OUTCOME_LABEL, STATUS_LABEL, type DisputeOutcome, type DisputeStatus, type DisputeView } from '@/lib/disputes/disputes.service'
import { filedByLine } from '@/lib/disputes/validation'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { DisputeAdminControls, FileDisputeForm } from './DisputeForms'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px',
}
const title: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }

const STATUS_TONE: Record<DisputeStatus, string> = { open: 'var(--highlight)', under_review: 'var(--brand)', resolved: 'var(--status-green)' }
const OUTCOME_TONE: Record<DisputeOutcome, string> = { upheld: 'var(--status-green)', partially_upheld: 'var(--highlight)', not_upheld: 'var(--text-muted)' }

export function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', borderStyle: 'solid', borderWidth: '1px', borderColor: color, color }}>{children}</span>
  )
}
export const DisputeStatusPill = ({ status }: { status: DisputeStatus }) => <Pill color={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
export const OutcomePill = ({ outcome }: { outcome: DisputeOutcome }) => <Pill color={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</Pill>

/** The dispute itself, worded the same way for everyone — a Team Lead's filing is ALWAYS shown as theirs, on the agent's behalf. */
export function DisputeDetails({ d, viewerIsAgent = false }: { d: DisputeView; viewerIsAgent?: boolean }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <DisputeStatusPill status={d.status} />
        {d.outcome && <OutcomePill outcome={d.outcome} />}
        <span style={{ fontSize: '13px', fontWeight: d.filedOnBehalf ? 600 : 400, color: d.filedOnBehalf ? 'var(--brand)' : 'var(--text-secondary)' }}>
          {filedByLine(d, viewerIsAgent)}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatDhakaDateTime(d.createdAt)}</span>
      </div>
      <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: '3px solid var(--border-strong)', paddingLeft: '12px' }}>{d.reason}</div>

      {d.status === 'under_review' && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>Under review{d.reviewedByName ? ` by ${d.reviewedByName}` : ' by QA'}{d.reviewedAt ? ` since ${formatDhakaDateTime(d.reviewedAt)}` : ''}.</div>
      )}
      {d.status === 'resolved' && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            Decision{d.resolvedByName ? ` by ${d.resolvedByName}` : ' by QA'}{d.resolvedAt ? ` · ${formatDhakaDateTime(d.resolvedAt)}` : ''}
          </div>
          <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: `3px solid ${d.outcome ? OUTCOME_TONE[d.outcome] : 'var(--border-strong)'}`, paddingLeft: '12px' }}>{d.resolutionNote}</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>This records the decision; it does not change the audit&apos;s score.</div>
        </div>
      )}
    </div>
  )
}

/**
 * The dispute section of an audit page (QA / Team Lead view and the agent's own view).
 *  - a dispute exists: show it, with Start review / Resolve for Super Admin & QA Manager;
 *  - none yet and the viewer may file (the agent, or their Team Lead): the form;
 *  - otherwise nothing.
 */
export function DisputePanel({
  auditId,
  auditStatus,
  dispute,
  viewer,
  agentName,
  youConductedAudit,
}: {
  auditId: string
  auditStatus: string
  dispute: DisputeView | null
  viewer: { role: string }
  agentName: string
  youConductedAudit: boolean
}) {
  const isAdmin = viewer.role === 'super_admin' || viewer.role === 'qa_manager'
  const isAgent = viewer.role === 'agent'
  const canFile = !dispute && auditStatus === 'submitted' && (isAgent || viewer.role === 'team_lead')
  if (!dispute && !canFile) return null

  return (
    <section style={card} aria-label="Dispute">
      <div style={title}>Dispute</div>
      {dispute ? (
        <>
          <DisputeDetails d={dispute} viewerIsAgent={isAgent} />
          {isAdmin && dispute.status !== 'resolved' && (
            <div style={{ marginTop: '14px' }}>
              <DisputeAdminControls disputeId={dispute.id} auditId={auditId} status={dispute.status} youConducted={youConductedAudit} />
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: '14px', marginBottom: '12px' }}>
            {isAgent
              ? 'If you believe this audit is wrong, you can formally dispute it. QA will review it and record a decision.'
              : `If ${agentName} wants to dispute this audit, you can file it for them. It is recorded as filed by you, as their Team Leader, on their behalf — not as their own.`}
          </div>
          <FileDisputeForm auditId={auditId} onBehalfOf={isAgent ? null : agentName} />
        </>
      )}
    </section>
  )
}
