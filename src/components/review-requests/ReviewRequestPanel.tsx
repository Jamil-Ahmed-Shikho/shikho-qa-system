import { STATUS_LABEL, filedByLine, type ReviewRequestView } from '@/lib/review-requests/review-requests.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { AssignControls, DecideRevisionControls, FileReviewRequestForm, StartReauditButton, TeamLeadDecideControls } from './ReviewRequestForms'
import Link from 'next/link'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px',
}
const title: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }

const STATUS_TONE: Record<string, string> = { with_team_lead: 'var(--highlight)', with_qa_manager: 'var(--brand)', resolved: 'var(--status-green)' }

export function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', borderStyle: 'solid', borderWidth: '1px', borderColor: color, color }}>{children}</span>
}
export const ReviewRequestStatusPill = ({ status }: { status: keyof typeof STATUS_LABEL }) => <Pill color={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>

/** The Review Request itself, worded the same way for everyone — a Team Lead/Manager's filing is ALWAYS shown as theirs. */
export function ReviewRequestDetails({ r, viewerIsAgent = false }: { r: ReviewRequestView; viewerIsAgent?: boolean }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <ReviewRequestStatusPill status={r.status} />
        <span style={{ fontSize: '13px', fontWeight: r.filerRole !== 'agent' ? 600 : 400, color: r.filerRole !== 'agent' ? 'var(--brand)' : 'var(--text-secondary)' }}>
          {filedByLine(r, viewerIsAgent)}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatDhakaDateTime(r.createdAt)}</span>
      </div>
      <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: '3px solid var(--border-strong)', paddingLeft: '12px' }}>{r.reason}</div>

      {r.teamLeadDecision && (
        <div style={{ marginTop: '12px', fontSize: '13px' }}>
          <b>Team Lead {r.teamLeadDecision === 'upheld' ? 'upheld the original' : 'escalated to QA Manager'}</b>
          {r.teamLeadDecidedByName ? ` — ${r.teamLeadDecidedByName}` : ''}{r.teamLeadDecidedAt ? ` · ${formatDhakaDateTime(r.teamLeadDecidedAt)}` : ''}
          {r.teamLeadNote && <div style={{ marginTop: '4px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{r.teamLeadNote}</div>}
        </div>
      )}
      {r.assignedToName && r.status === 'with_qa_manager' && !r.finalOutcome && (
        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Assigned to <b>{r.assignedToName}</b> for a re-audit
          {r.reaudit && (
            <>
              {' — '}
              {r.reaudit.status === 'draft' ? (
                <Link href={`/audits/${r.reaudit.id}`} style={{ color: 'var(--brand)' }}>re-audit in progress →</Link>
              ) : (
                <>re-audit submitted: {r.reaudit.scorePercent === null ? '—' : `${r.reaudit.scorePercent}%`}{r.reaudit.passed === false ? ' (did not pass)' : ''}</>
              )}
            </>
          )}
        </div>
      )}
      {r.finalOutcome && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            Decision{r.finalDecidedByName ? ` by ${r.finalDecidedByName}` : ' by QA'}{r.finalDecidedAt ? ` · ${formatDhakaDateTime(r.finalDecidedAt)}` : ''}
          </div>
          <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: `3px solid ${r.finalOutcome === 'revised' ? 'var(--status-green)' : 'var(--border-strong)'}`, paddingLeft: '12px' }}>
            <b>{r.finalOutcome === 'revised' ? 'Revised' : 'No change'}.</b> {r.finalNote}
          </div>
          {r.finalOutcome === 'revised' && r.reaudit && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
              The <Link href={`/audits/${r.reaudit.id}`} style={{ color: 'var(--brand)' }}>re-audit</Link> is now the effective result for this audit. The original record is unchanged, kept for history.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The Review Request section of an audit page — the agent's own view (`/my-audits/[id]`) and the
 * QA/Team Lead/Manager view (`/audits/[id]`). REPLACES DisputePanel.tsx entirely.
 */
export function ReviewRequestPanel({
  auditId,
  auditStatus,
  request,
  viewer,
  agentName,
  isOwnTeamAgent,
  isOwnChainAgent,
  qaStaff,
}: {
  auditId: string
  auditStatus: string
  request: ReviewRequestView | null
  viewer: { role: string; id: string }
  agentName: string
  /** Only meaningful for a Team Lead viewer: is this audit's agent on their own team? */
  isOwnTeamAgent: boolean
  /** Only meaningful for a Manager viewer: is this audit's agent in their own chain? */
  isOwnChainAgent: boolean
  /** Only needed for QA Manager/Super Admin's assignment control. */
  qaStaff?: { id: string; name: string; role: string }[]
}) {
  const isAdmin = viewer.role === 'super_admin' || viewer.role === 'qa_manager'
  const isAgent = viewer.role === 'agent'
  const isTeamLead = viewer.role === 'team_lead'
  const isManager = viewer.role === 'manager'
  const canFile =
    !request && auditStatus === 'submitted' &&
    ((isAgent) || (isTeamLead && isOwnTeamAgent) || (isManager && isOwnChainAgent))
  if (!request && !canFile) return null

  return (
    <section style={card} aria-label="Review Request">
      <div style={title}>Review Request</div>
      {request ? (
        <>
          <ReviewRequestDetails r={request} viewerIsAgent={isAgent} />
          {isTeamLead && isOwnTeamAgent && request.status === 'with_team_lead' && (
            <div style={{ marginTop: '14px' }}><TeamLeadDecideControls id={request.id} auditId={auditId} /></div>
          )}
          {isAdmin && request.status === 'with_qa_manager' && (
            <div style={{ marginTop: '14px' }}>
              {!request.assignedToId && qaStaff && <AssignControls id={request.id} auditId={auditId} qaStaff={qaStaff} />}
              {request.assignedToId && !request.reaudit && <StartReauditButton id={request.id} auditId={auditId} />}
              {request.reaudit && request.reaudit.status !== 'draft' && <DecideRevisionControls id={request.id} auditId={auditId} />}
            </div>
          )}
          {viewer.role === 'qa_auditor' && request.status === 'with_qa_manager' && request.assignedToId === viewer.id && !request.reaudit && (
            <div style={{ marginTop: '14px' }}><StartReauditButton id={request.id} auditId={auditId} /></div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: '14px', marginBottom: '12px' }}>
            {isAgent
              ? 'If you believe this audit is wrong, you can formally request a review. Your Team Lead sees it first.'
              : `If ${agentName} wants this audit reviewed, you can file it for them. It is recorded as filed by you on their behalf — not as their own — and goes straight to QA Manager.`}
          </div>
          <FileReviewRequestForm auditId={auditId} onBehalfOf={isAgent ? null : agentName} />
        </>
      )}
    </section>
  )
}
