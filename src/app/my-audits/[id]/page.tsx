import { notFound } from 'next/navigation'
import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { RecordingPlayer } from '@/components/audits/RecordingPlayer'
import { ScorecardSummary } from '@/components/audits/ScorecardSummary'
import { ReviewRequestPanel } from '@/components/review-requests/ReviewRequestPanel'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadScorecard } from '@/lib/audits/scorecard.service'
import { isRecordingFilename, recordingConfigured } from '@/lib/crm/recording'
import { crmLeadUrl } from '@/lib/crm/lead-id-parser'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { isMissingReviewRequestSchema, loadEffectiveResult, loadReviewRequestForAudit, type ReviewRequestView } from '@/lib/review-requests/review-requests.service'
import { getSupabaseServer } from '@/lib/supabase/server'

/**
 * An agent's own view of ONE submitted audit — the scorecard, the feedback, the call recording — and
 * the place to file a Review Request. Row-level security limits the audit to the agent's own non-draft
 * audits, so any other id is a 404.
 *
 * Visibility (§4, Section D, Q22 — CHANGED 2026-09-29): the agent now sees the Special Check answers,
 * root-cause tags, who audited them, and a link to the lead in the CRM. Still NOT shown: any
 * re-audit/CAPA flag, or anyone else's anything.
 */
export default async function MyAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabaseServer()
  const [user, { data: audit, error }] = await Promise.all([
    getAuthUser(),
    supabase
      .from('audits')
      .select(
        `id, status, rubric_id, score_percent, passed, critical_fail, pass_mark_used, submitted_at, overall_feedback,
        call_started_at, call_status, call_recording_url, crm_lead_id, superseded_by,
        auditor:users!audits_auditor_id_fkey(name)`
      )
      .eq('id', id)
      .maybeSingle(),
  ])
  if (error) {
    console.error(error)
    return (
      <div>
        <BackLink href="/my-audits" label="My audits" size="lg" />
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>This audit could not be loaded right now. Try again shortly.</div>
      </div>
    )
  }
  if (!audit) notFound()
  const auditorRaw = audit.auditor as { name: string } | { name: string }[] | null
  const auditorName = (Array.isArray(auditorRaw) ? auditorRaw[0]?.name : auditorRaw?.name) ?? null

  const effective = await loadEffectiveResult({
    score_percent: audit.score_percent, passed: audit.passed, critical_fail: audit.critical_fail,
    pass_mark_used: audit.pass_mark_used, submitted_at: audit.submitted_at, overall_feedback: audit.overall_feedback,
    rubric_id: audit.rubric_id, superseded_by: audit.superseded_by,
  }).catch((err) => {
    console.error(err)
    return null
  })
  const scorecardAuditId = effective?.isRevision ? (audit.superseded_by as string) : audit.id

  const [scorecard, requestInfo] = await Promise.all([
    loadScorecard(scorecardAuditId, effective?.rubricId ?? audit.rubric_id, effective?.overallFeedback ?? audit.overall_feedback, { agentTeam: null, isDraft: false }).catch((err) => {
      console.error(err)
      return null
    }),
    loadReviewRequestForAudit(audit.id).then(
      (request): { request: ReviewRequestView | null; failed: boolean } => ({ request, failed: false }),
      (err) => {
        const missing = isMissingReviewRequestSchema(err)
        if (!missing) console.error(err)
        return { request: null, failed: !missing }
      }
    ),
  ])

  const recording = audit.call_recording_url as string | null
  const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px' }

  return (
    <div>
      <BackLink href="/my-audits" label="My audits" size="lg" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Audit of your call</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Call on {formatDhakaDateTime(audit.call_started_at)} · audited {formatDhakaDateTime(audit.submitted_at)}
            {auditorName && <> · by {auditorName}</>}
          </p>
          {audit.crm_lead_id && (
            <a
              href={crmLeadUrl(audit.crm_lead_id)}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px',
                fontSize: '13px', fontWeight: 600, color: 'var(--brand)', textDecoration: 'none',
                padding: '7px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--brand-light)',
              }}
            >
              View lead in CRM →
            </a>
          )}
        </div>
        <span style={{ fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--brand-light)', color: 'var(--brand)', textTransform: 'capitalize' }}>
          {audit.status.replace('_', ' ')}
        </span>
      </div>

      {recording && isRecordingFilename(recording) && recordingConfigured() && (
        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>Your call</h3>
          <RecordingPlayer src={`/api/audits/${audit.id}/recording`} />
        </div>
      )}

      {effective?.isRevision && (
        <div style={{ ...card, borderColor: 'var(--status-green)', fontSize: '13px' }}>
          <b>This audit was revised</b> following a Review Request. The result below is the revised one.
        </div>
      )}

      <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>Result</h2>
      {!scorecard || !effective ? (
        <div role="alert" style={{ ...card, color: 'var(--alert)', fontSize: '13px', borderColor: 'var(--alert)' }}>
          The scorecard could not be loaded right now. This does not mean it is empty — try again shortly.
        </div>
      ) : (
        <ScorecardSummary
          rubric={scorecard.rubric}
          saved={scorecard.saved}
          special={scorecard.special}
          score={{
            score_percent: effective.scorePercent,
            passed: effective.passed,
            critical_fail: effective.criticalFail,
            pass_mark_used: effective.passMarkUsed,
            submitted_at: effective.submittedAt,
          }}
        />
      )}

      {requestInfo.failed && (
        <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)', marginBottom: '20px' }}>
          The Review Request status could not be loaded right now. This does not mean there is none — reload to check before filing one.
        </div>
      )}
      {!requestInfo.failed && user && (
        <ReviewRequestPanel
          auditId={audit.id}
          auditStatus={audit.status}
          request={requestInfo.request}
          viewer={{ role: user.role, id: user.profile.id }}
          agentName={user.profile.name}
          isOwnTeamAgent={false}
          isOwnChainAgent={false}
        />
      )}
    </div>
  )
}
