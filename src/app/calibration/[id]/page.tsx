import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { RecordingPlayer } from '@/components/audits/RecordingPlayer'
import { CancelButton } from '@/components/calibration/CancelButton'
import { SessionForm } from '@/components/calibration/SessionForm'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { getSession, loadCalibrationRubric, loadCandidates, loadReportSentAt, loadResults, loadRubricChoices, type CalibrationResultsState } from '@/lib/calibration/calibration.service'
import { ScoringForm } from '@/components/calibration/ScoringForm'
import { CloseButton } from '@/components/calibration/CloseButton'
import { SendReportButton } from '@/components/calibration/SendReportButton'
import { VarianceReportView } from '@/components/calibration/VarianceReportView'
import { buildVarianceReport } from '@/lib/calibration/variance'
import { KIND_LABELS, toDhakaLocalInput } from '@/lib/calibration/validation'
import { SITE_NAMES } from '@/lib/users/constants'
import { TEAM_NAMES } from '@/types/database.types'

const card: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '16px',
}
const ROLE_LABEL: Record<string, string> = { qa_auditor: 'QA Auditor', qa_manager: 'QA Manager', super_admin: 'Super Admin', team_lead: 'Team Lead' }
const STATUS_LABEL = { scheduled: 'Scheduled', closed: 'Closed', cancelled: 'Cancelled' } as const

export default async function CalibrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getAuthUser()
  const found = await getSession(id)
  if (!found || !user) notFound()
  const { session: s, participants } = found
  const isAdmin = ['super_admin', 'qa_manager'].includes(user.role)
  const canEdit = s.status === 'scheduled' && (isAdmin || s.createdBy === user.profile.id)

  let results: CalibrationResultsState | null = null
  let resultsFailed = false
  try {
    results = await loadResults(s.id)
  } catch (err) {
    resultsFailed = true
    console.error(err)
  }
  const canSendReport = s.status === 'closed' && (isAdmin || s.createdBy === user.profile.id)
  const reportSentAt = canSendReport ? await loadReportSentAt(s.id) : null
  const rubric = results && s.status !== 'cancelled' ? await loadCalibrationRubric(s.rubricId) : null

  const [candidates, choices] = canEdit ? await Promise.all([loadCandidates(), loadRubricChoices()]) : [[], { rubrics: [], byTeam: {} }]

  return (
    <div>
      <BackLink href="/calibration" label="Calibration sessions" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>
        {s.title ?? (s.itemType === 'call' ? `Call ${s.crmCallId}` : s.itemReference)}
      </h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
        {KIND_LABELS[s.kind]} Â· {STATUS_LABEL[s.status]}
      </p>

      <section style={card} aria-label="Details">
        <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 12px', margin: 0, fontSize: '14px' }}>
          <dt style={{ color: 'var(--text-muted)' }}>When (Dhaka)</dt><dd style={{ margin: 0 }}>{formatDhakaDateTime(s.scheduledAt)}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Scope</dt><dd style={{ margin: 0 }}>{s.teamName} Â· {s.siteName}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Rubric</dt><dd style={{ margin: 0 }}>{s.rubricName ?? 'â€”'}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>Scheduled by</dt><dd style={{ margin: 0 }}>{s.schedulerName ?? 'QA team'}</dd>
          {s.itemType === 'call' ? (
            <>
              <dt style={{ color: 'var(--text-muted)' }}>Call</dt>
              <dd style={{ margin: 0 }}>
                {s.crmCallId} on lead {s.crmLeadId}{s.callStartedAt ? ` Â· ${formatDhakaDateTime(s.callStartedAt)}` : ''}{s.callStatus ? ` Â· ${s.callStatus}` : ''}
              </dd>
            </>
          ) : (
            <>
              <dt style={{ color: 'var(--text-muted)' }}>{s.itemType === 'chat' ? 'Chat' : 'Complaint'}</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>{s.itemReference}</dd>
            </>
          )}
        </dl>
      </section>

      {s.itemType === 'call' && s.status !== 'cancelled' && (
        <section style={card} aria-label="Recording">
          <h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Recording</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>Listen beforehand and form your own score.</p>
          <RecordingPlayer src={`/api/calibration/${s.id}/recording`} />
        </section>
      )}

      <section style={card} aria-label="Participants">
        <h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Participants ({participants.length})</h2>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '14px' }}>
          {participants.map((p) => (
            <li key={p.userId}>{p.name} <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{ROLE_LABEL[p.role] ?? p.role}{p.isScheduler ? ' Â· scheduler' : ''}</span></li>
          ))}
        </ul>

      </section>

      {resultsFailed && (
        <section style={card} aria-label="Scoring">
          <p role="alert" style={{ color: 'var(--alert)', fontSize: '14px', margin: 0 }}>Scoring could not be loaded right now (if this is new, apply <code>schema_032_calibration_scoring.sql</code>). This does not mean nobody has scored.</p>
        </section>
      )}

      {results?.canScore && rubric && (
        <section style={card} aria-label="Your score">
          <h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Your score</h2>
          <ScoringForm sessionId={s.id} rubric={rubric} />
        </section>
      )}

      {results?.isParticipant && results.mySubmitted && !results.revealed && (
        <section style={card} aria-label="Your score">
          <h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Your score is in</h2>
          <p style={{ fontSize: '14px', margin: 0 }}>
            You scored <b>{results.scores[0]?.scorePercent}%</b> — final. {results.submittedCount} of {results.participantCount} have submitted.
            Everyone&apos;s scores and the variance report appear after {formatDhakaDateTime(s.scheduledAt)}, or when the session is closed.
          </p>
        </section>
      )}

      {results && !results.revealed && !results.isParticipant && s.status === 'scheduled' && (
        <section style={card} aria-label="Scores">
          <p style={{ fontSize: '14px', margin: 0 }}>{results.submittedCount} of {results.participantCount} participants have submitted. Scores are shown after {formatDhakaDateTime(s.scheduledAt)} or when the session is closed.</p>
        </section>
      )}

      {results?.isParticipant && !results.mySubmitted && !results.canScore && !results.revealed && s.status !== 'cancelled' && (
        <section style={card} aria-label="Scoring closed">
          <p style={{ fontSize: '14px', margin: 0 }}>Submit your own score to see the others&apos; after {formatDhakaDateTime(s.scheduledAt)}.</p>
        </section>
      )}

      {results?.revealed && rubric && (
        <section style={card} aria-label="Variance report">
          <h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Variance report</h2>
          <VarianceReportView report={buildVarianceReport(results.scores, rubric)} />
        </section>
      )}

      {canSendReport && (
        <section style={card} aria-label="Send report">
          <h2 style={{ fontSize: '15px', margin: '0 0 4px' }}>Email the report</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
            Sends the variance report to all {participants.length} participants. Nothing is sent unless you press the button.
            {reportSentAt ? ` Last sent ${formatDhakaDateTime(reportSentAt)}.` : ''}
          </p>
          <SendReportButton id={s.id} alreadySentLabel={reportSentAt ? formatDhakaDateTime(reportSentAt) : null} participantCount={participants.length} />
        </section>
      )}
      {canEdit && (
        <section style={card} aria-label="Close this session">
          <h2 style={{ fontSize: '15px', margin: '0 0 4px' }}>Close this session</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 10px' }}>Stops scoring and reveals every score to every participant. Needs at least two submitted scores.</p>
          <CloseButton id={s.id} />
        </section>
      )}
      {canEdit && (
        <section style={card} aria-label="Change this session">
          <h2 style={{ fontSize: '15px', margin: '0 0 4px' }}>Change this session</h2>
          <SessionForm
            mode="edit"
            sessionId={s.id}
            candidates={candidates}
            rubrics={choices.rubrics}
            rubricByTeam={choices.byTeam}
            teams={TEAM_NAMES}
            sites={SITE_NAMES}
            viewerId={s.createdBy}
            initial={{
              kind: s.kind, title: s.title ?? '', itemType: s.itemType, itemReference: s.itemReference ?? '',
              leadId: s.crmLeadId ?? '', callId: s.crmCallId ?? '', rubricId: s.rubricId, teamName: s.teamName, siteName: s.siteName,
              scheduledLocal: toDhakaLocalInput(s.scheduledAt),
              participantIds: participants.filter((p) => !p.isScheduler).map((p) => p.userId),
            }}
          />
          <div style={{ marginTop: '20px' }}><CancelButton id={s.id} /></div>
        </section>
      )}
    </div>
  )
}


