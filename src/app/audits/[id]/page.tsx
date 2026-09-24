import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getCallById, CrmApiError } from '@/lib/crm/client'
import { isRecordingFilename, recordingConfigured } from '@/lib/crm/recording'
import { RecordingPlayer } from '@/components/audits/RecordingPlayer'
import { loadScorecard } from '@/lib/audits/scorecard.service'
import { ReleaseDraftButton } from '@/components/audits/ReleaseDraftButton'
import { loadAgentCoachingHistory, type CoachingHistoryItem } from '@/lib/briefings/briefings.service'
import { ScheduleCoaching } from '@/components/audits/ScheduleCoaching'
import { Scorecard } from '@/components/audits/Scorecard'
import { ScorecardSummary } from '@/components/audits/ScorecardSummary'

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabaseServer()
  const user = await getAuthUser()

  const { data: audit, error } = await supabase
    .from('audits')
    .select(
      `*,
      agent:users!audits_agent_id_fkey(name, email, team_name),
      auditor:users!audits_auditor_id_fkey(name, email)`
    )
    .eq('id', id)
    .single()

  if (error || !audit) notFound()

  const agent = audit.agent as unknown as { name: string; email: string; team_name: string | null }
  const auditor = audit.auditor as unknown as { name: string; email: string }

  let lead: { name?: string; phone?: string; class?: string; group?: string; stage?: string } | null = null
  let crmError: string | null = null
  if (audit.crm_call_id) {
    try {
      const call = await getCallById(audit.crm_call_id, user?.profile.id ?? null)
      lead = call?.lead ?? null
    } catch (err) {
      crmError = err instanceof CrmApiError ? err.message : 'Could not refresh lead info from the CRM.'
    }
  }

  // What the CRM calls recording_url is a bare filename, not a URL.
  const recording = audit.call_recording_url as string | null

  // Coaching (§5): the agent's whole history is loaded with the page so the
  // scheduler sees, before clicking anything, whether a session is already
  // booked and when the last one was. null = it could not be loaded (shown
  // as such — never as "no history", which would invite a double-booking).
  const canSchedule = !!user && ['qa_auditor', 'qa_manager', 'super_admin'].includes(user.role)
  let coachingHistory: CoachingHistoryItem[] | null = null
  if (canSchedule && audit.status !== 'draft') {
    try {
      coachingHistory = await loadAgentCoachingHistory(audit.agent_id)
    } catch (err) {
      console.error(err)
    }
  }

  const isOwner = user?.profile.id === audit.auditor_id
  const canRelease = isOwner && audit.status === 'draft'

  // The rubric LOCKED when this audit was started (audits.rubric_id), plus
  // whatever has been saved against it.
  const scorecard = await loadScorecard(audit.id, audit.rubric_id, audit.overall_feedback, {
    agentTeam: agent?.team_name ?? null,
    isDraft: audit.status === 'draft',
  })

  return (
    <div>
      <Link
        href={audit.crm_lead_id ? `/audits/leads/${audit.crm_lead_id}` : '/audits'}
        style={{ fontSize: '13px', color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        ← Back to call list
      </Link>
      <div style={{ height: '12px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>
            {lead?.name || `Lead #${audit.crm_lead_id}`}
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            {[lead?.phone, lead?.class, lead?.group, lead?.stage].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)',
          background: 'var(--brand-light)', color: 'var(--brand)', textTransform: 'capitalize',
        }}>
          {audit.status}
        </span>
      </div>

      {crmError && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px', fontSize: '13px', color: 'var(--alert)', marginBottom: '16px',
        }}>
          {crmError}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px',
        marginBottom: '20px',
      }}>
        <InfoCard title="Agent">
          <div style={{ fontWeight: 600 }}>{agent?.name}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{agent?.email}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{agent?.team_name}</div>
        </InfoCard>
        <InfoCard title="Auditor">
          <div style={{ fontWeight: 600 }}>{auditor?.name}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{auditor?.email}</div>
        </InfoCard>
        <InfoCard title="Call">
          <div style={{ fontSize: '13px' }}>{audit.call_started_at && new Date(audit.call_started_at).toLocaleString()}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {audit.call_destination} · {audit.call_status}
          </div>
        </InfoCard>
      </div>

      <div style={{
        background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '20px', marginBottom: '20px',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>Recording</h3>
        {!recording ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
            No recording for this call{audit.call_status ? ` (status: ${audit.call_status})` : ''}.
          </p>
        ) : !isRecordingFilename(recording) ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--alert)' }}>
            This call&apos;s recording reference isn&apos;t in a recognised format, so it can&apos;t be played.
          </p>
        ) : !recordingConfigured() ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Recording playback isn&apos;t set up yet. The CRM only stores this call&apos;s recording filename
            (<code>{recording}</code>) — set <code>CRM_RECORDING_BASE_URL</code> to where those files are hosted.
          </p>
        ) : (
          // Streamed through our own proxy, never downloaded or stored (§10)
          <RecordingPlayer src={`/api/audits/${audit.id}/recording`} />
        )}
      </div>

      <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>
        {audit.status === 'draft' ? 'Scorecard' : 'Result'}
      </h2>

      {!scorecard ? (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-md)',
          padding: '16px', fontSize: '13px', color: 'var(--alert)', marginBottom: '20px',
        }}>
          Could not load this audit&apos;s scorecard (its rubric may have been removed).
        </div>
      ) : audit.status !== 'draft' ? (
        <ScorecardSummary
          rubric={scorecard.rubric}
          saved={scorecard.saved}
          special={scorecard.special}
          score={{
            score_percent: audit.score_percent === null ? null : Number(audit.score_percent),
            passed: audit.passed,
            critical_fail: audit.critical_fail,
            pass_mark_used: audit.pass_mark_used === null ? null : Number(audit.pass_mark_used),
            submitted_at: audit.submitted_at,
          }}
        />
      ) : isOwner ? (
        <Scorecard
          auditId={audit.id}
          rubric={scorecard.rubric}
          savedPayload={scorecard.saved}
          passMark={scorecard.passMark}
          special={scorecard.special}
          agentTeam={agent?.team_name ?? null}
        />
      ) : (
        <div style={{
          background: 'var(--surface-1)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)',
          padding: '20px', color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px',
        }}>
          Draft in progress — {auditor?.name} has scored {scorecard.saved.results.length} of{' '}
          {scorecard.rubric.categories.reduce((n, c) => n + c.parameters.length, 0)} parameters so far.
          Only they can score it.
        </div>
      )}

      {canRelease && (
        <div style={{ marginTop: '24px' }}>
          <ReleaseDraftButton auditId={audit.id} leadId={audit.crm_lead_id ?? ''} />
        </div>
      )}

      {audit.status !== 'draft' && (
        <ScheduleCoaching
          auditId={audit.id}
          canSchedule={canSchedule}
          criticalFail={audit.critical_fail}
          initialHistory={coachingHistory}
        />
      )}
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      padding: '16px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}
