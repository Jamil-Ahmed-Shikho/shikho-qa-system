import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { RecordingPlayer } from '@/components/audits/RecordingPlayer'
import { ScorecardSummary } from '@/components/audits/ScorecardSummary'
import { DisputePanel } from '@/components/disputes/DisputePanel'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadScorecard } from '@/lib/audits/scorecard.service'
import { isRecordingFilename, recordingConfigured } from '@/lib/crm/recording'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { isMissingDisputesSchema, loadDisputeForAudit, type DisputeView } from '@/lib/disputes/disputes.service'
import { getSupabaseServer } from '@/lib/supabase/server'

/**
 * An agent's own view of ONE submitted audit — the scorecard, the feedback, the call recording — and the place to
 * dispute it. Row-level security limits the audit to the agent's own non-draft audits, so any other id is a 404.
 * Deliberately NOT shown: the Special Check answers (management-only), who conducted it (their profile isn't the
 * agent's to read), CRM lead details, revenue, and re-audit flags (internal QA bookkeeping).
 */
export default async function MyAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabaseServer()
  const [user, { data: audit, error }] = await Promise.all([
    getAuthUser(),
    supabase
      .from('audits')
      .select('id, status, rubric_id, score_percent, passed, critical_fail, pass_mark_used, submitted_at, overall_feedback, call_started_at, call_status, call_recording_url')
      .eq('id', id)
      .maybeSingle(),
  ])
  if (error) {
    console.error(error)
    return (
      <div>
        <BackLink href="/my-audits" label="My audits" />
        <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>This audit could not be loaded right now. Try again shortly.</div>
      </div>
    )
  }
  if (!audit) notFound()

  const [scorecard, disputeInfo] = await Promise.all([
    loadScorecard(audit.id, audit.rubric_id, audit.overall_feedback, { agentTeam: null, isDraft: false }).catch((err) => {
      console.error(err)
      return null
    }),
    loadDisputeForAudit(audit.id).then(
      (dispute): { dispute: DisputeView | null; failed: boolean } => ({ dispute, failed: false }),
      (err) => {
        const missing = isMissingDisputesSchema(err)
        if (!missing) console.error(err)
        return { dispute: null, failed: !missing }
      }
    ),
  ])

  const recording = audit.call_recording_url as string | null
  const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px' }

  return (
    <div>
      <BackLink href="/my-audits" label="My audits" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Audit of your call</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Call on {formatDhakaDateTime(audit.call_started_at)} · audited {formatDhakaDateTime(audit.submitted_at)}
          </p>
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

      <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>Result</h2>
      {!scorecard ? (
        <div role="alert" style={{ ...card, color: 'var(--alert)', fontSize: '13px', borderColor: 'var(--alert)' }}>
          The scorecard could not be loaded right now. This does not mean it is empty — try again shortly.
        </div>
      ) : (
        <ScorecardSummary
          rubric={scorecard.rubric}
          saved={scorecard.saved}
          special={[]}
          showRootCause={false}
          score={{
            score_percent: audit.score_percent === null ? null : Number(audit.score_percent),
            passed: audit.passed,
            critical_fail: audit.critical_fail,
            pass_mark_used: audit.pass_mark_used === null ? null : Number(audit.pass_mark_used),
            submitted_at: audit.submitted_at,
          }}
        />
      )}

      {disputeInfo.failed && (
        <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)', marginBottom: '20px' }}>
          The dispute status could not be loaded right now. This does not mean there is none — reload to check before filing one.
        </div>
      )}
      {!disputeInfo.failed && user && (
        <DisputePanel
          auditId={audit.id}
          auditStatus={audit.status}
          dispute={disputeInfo.dispute}
          viewer={{ role: user.role }}
          agentName={user.profile.name}
          youConductedAudit={false}
        />
      )}
    </div>
  )
}
