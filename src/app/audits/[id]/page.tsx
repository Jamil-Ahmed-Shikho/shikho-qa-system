import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { isRecordingFilename, recordingConfigured } from '@/lib/crm/recording'
import { RecordingPlayer } from '@/components/audits/RecordingPlayer'
import { loadScorecard } from '@/lib/audits/scorecard.service'
import { ReleaseDraftButton } from '@/components/audits/ReleaseDraftButton'
import { loadAgentCoachingHistory, type CoachingHistoryItem } from '@/lib/briefings/briefings.service'
import { BackLink } from '@/components/common/BackLink'
import { CallStatusPill } from '@/components/audits/CallStatusPill'
import { AuditContextCards } from '@/components/audits/AuditContextCards'
import { loadAgentRevenue, RevenueNeedsMigrationError } from '@/lib/audits/audit-context.service'
import { getLeadSummary } from '@/lib/crm/client'
import { agentVintage } from '@/lib/agents/vintage'
import { loadVintageSlabs } from '@/lib/agents/vintage.service'
import { isMissingCapaSchema, loadCapaInfo, type CapaInfo } from '@/lib/capa/capa.service'
import { isMissingReviewRequestSchema, loadEffectiveResult, loadReviewRequestForAudit, type ReviewRequestView } from '@/lib/review-requests/review-requests.service'
import { CapaPanel } from '@/components/audits/CapaPanel'
import { ReviewRequestPanel } from '@/components/review-requests/ReviewRequestPanel'
import { formatCallDuration } from '@/lib/dates/duration'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { ScheduleCoaching } from '@/components/audits/ScheduleCoaching'
import { Scorecard } from '@/components/audits/Scorecard'
import { ScorecardSummary } from '@/components/audits/ScorecardSummary'
import { loadSampleCheck } from '@/lib/audits/sample-check.service'
import { SampleCheckForm } from '@/components/audits/SampleCheckForm'
import { SampleCheckSummary } from '@/components/audits/SampleCheckSummary'
import { crmLeadUrl } from '@/lib/crm/lead-id-parser'

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabaseServer()

  // The audit row and the signed-in user don't depend on each other.
  const [user, { data: audit, error }, vintageSlabs] = await Promise.all([
    getAuthUser(),
    supabase
      .from('audits')
      .select(
        `*,
      agent:users!audits_agent_id_fkey(name, email, team_name, team_leader_id, joining_date, employment_stage),
      auditor:users!audits_auditor_id_fkey(name, email)`
      )
      .eq('id', id)
      .single(),
    loadVintageSlabs(), // independent of the audit: fetched alongside it, not after it
  ])

  if (error || !audit) notFound()

  const agent = audit.agent as unknown as {
    name: string
    email: string
    team_name: string | null
    team_leader_id: string | null
    joining_date: string | null
    employment_stage: string
  }
  const vintage = agentVintage({ employment_stage: agent?.employment_stage ?? 'active', joining_date: agent?.joining_date ?? null }, vintageSlabs)
  const auditor = audit.auditor as unknown as { name: string; email: string }

  // Phase 3 (schema_073): a Sample Check has no rubric, no CAPA flag, no Review Request
  // (both are about a SCORE, which a Sample Check never has) and no coaching-schedule prompt
  // (§5, confirmed design) — those sections are skipped entirely below, not shown empty.
  const isSampleCheck = audit.check_mode === 'sample_check'

  // (This page used to fetch the call from the CRM just to read a nested
  // `lead` object — but the CRM's call objects no longer carry one, so that
  // request always came back empty and added a network round trip to every
  // page load. Lead details come from GET /leads/{id} instead — see the
  // lead panel below.)
  // What the CRM calls recording_url is a bare filename, not a URL.
  const recording = audit.call_recording_url as string | null

  // Coaching (§5): the agent's whole history is loaded with the page so the
  // scheduler sees, before clicking anything, whether a session is already
  // booked and when the last one was. null = it could not be loaded (shown
  // as such — never as "no history", which would invite a double-booking).
  const canSchedule = !isSampleCheck && !!user && ['qa_auditor', 'qa_manager', 'super_admin'].includes(user.role)
  const historyPromise: Promise<CoachingHistoryItem[] | null> =
    canSchedule && audit.status !== 'draft'
      ? loadAgentCoachingHistory(audit.agent_id).catch((err) => {
          console.error(err)
          return null
        })
      : Promise.resolve(null)

  const isOwner = user?.profile.id === audit.auditor_id
  const canRelease = isOwner && audit.status === 'draft'

  // QA staff options for assigning a Review Request's re-audit (Section D, Part 1) — only an
  // admin ever needs this list, and it's cheap, so it's fetched unconditionally for them rather
  // than threading a second round trip through every branch that might need it.
  const qaStaffOptions = user && ['super_admin', 'qa_manager'].includes(user.role)
    ? await supabase.from('users').select('id, name, role').in('role', ['super_admin', 'qa_manager', 'qa_auditor']).eq('is_active', true).order('name')
        .then(
          ({ data }) => (data ?? []).map((u) => ({ id: u.id, name: u.id === user.profile.id ? `${u.name} (you)` : u.name, role: u.role })),
          () => []
        )
    : undefined

  // The rubric LOCKED when this audit was started (audits.rubric_id), plus
  // whatever has been saved against it.
  // Lead details (CRM) and revenue (our tables) load alongside the scorecard.
  // Each fails independently and says so on screen — a failed lookup must not
  // read as "no data", and must not take the page down.
  const leadPromise = audit.crm_lead_id
    ? getLeadSummary(audit.crm_lead_id, user?.profile.id ?? null).then(
        (lead) => ({ lead, unavailable: false }),
        (err) => {
          console.error('Lead lookup failed:', err instanceof Error ? err.message : err)
          return { lead: null, unavailable: true }
        }
      )
    : Promise.resolve({ lead: null, unavailable: false })
  const revenuePromise = loadAgentRevenue(audit.agent_id).then(
    (revenue) => ({ revenue, needsUpdate: false }),
    (err) => {
      const needsUpdate = err instanceof RevenueNeedsMigrationError
      if (!needsUpdate) console.error(err)
      return { revenue: null, needsUpdate }
    }
  )

  // CAPA, Review Requests and revisions are all about a SCORE — none of them apply to a Sample
  // Check, so they're skipped entirely (not loaded, not rendered) rather than shown empty.
  const capaPromise: Promise<CapaInfo | null> = isSampleCheck ? Promise.resolve(null) : loadCapaInfo({
    id: audit.id, agent_id: audit.agent_id, status: audit.status, re_audit_of: audit.re_audit_of ?? null, capa_status: audit.capa_status ?? null,
  }).catch((err) => {
    if (!isMissingCapaSchema(err)) console.error(err)
    return null
  })
  const requestPromise: Promise<{ request: ReviewRequestView | null; failed: boolean }> =
    isSampleCheck || audit.status === 'draft'
      ? Promise.resolve({ request: null, failed: false })
      : loadReviewRequestForAudit(audit.id).then(
          (request) => ({ request, failed: false }),
          (err) => {
            const missing = isMissingReviewRequestSchema(err)
            if (!missing) console.error(err)
            return { request: null, failed: !missing }
          }
        )

  // If this audit has been REVISED (Q16 — a Review Request's approved re-audit), the revision's
  // own figures are the effective ones to show; the original row itself is never edited (§4).
  const effectivePromise = isSampleCheck ? Promise.resolve(null) : loadEffectiveResult({
    score_percent: audit.score_percent, passed: audit.passed, critical_fail: audit.critical_fail,
    pass_mark_used: audit.pass_mark_used, submitted_at: audit.submitted_at, overall_feedback: audit.overall_feedback,
    rubric_id: audit.rubric_id, superseded_by: audit.superseded_by ?? null,
  }).catch((err) => { console.error(err); return null })

  // Loaded together with the coaching history rather than one after the other. A Sample Check
  // has no rubric scorecard at all — loadSampleCheck() loads only its Special Check campaigns.
  const [scorecardForOriginal, sampleCheck, coachingHistory, leadInfo, revenueInfo, capa, requestInfo, effective] = await Promise.all([
    isSampleCheck ? Promise.resolve(null) : loadScorecard(audit.id, audit.rubric_id, audit.overall_feedback, {
      agentTeam: agent?.team_name ?? null,
      isDraft: audit.status === 'draft',
    }),
    isSampleCheck ? loadSampleCheck(audit.id, audit.overall_feedback, { agentTeam: agent?.team_name ?? null, isDraft: audit.status === 'draft' }) : Promise.resolve(null),
    historyPromise,
    leadPromise,
    revenuePromise,
    capaPromise,
    requestPromise,
    effectivePromise,
  ])
  // A revised audit's PARAMETER results live on the re-audit's own row -- load those instead of
  // the original's when displaying the summary (draft scoring always uses the original, unaffected).
  const scorecard = effective?.isRevision && audit.superseded_by
    ? await loadScorecard(audit.superseded_by, effective.rubricId, effective.overallFeedback, { agentTeam: agent?.team_name ?? null, isDraft: false }).catch((err) => { console.error(err); return scorecardForOriginal })
    : scorecardForOriginal

  return (
    <div>
      {/* Asks first if the scorecard has unsaved changes (see lib/ui/unsaved.ts). */}
      <BackLink
        href={audit.crm_lead_id ? `/audits/leads/${audit.crm_lead_id}` : '/audits'}
        label={audit.crm_lead_id ? 'Back to call list' : 'Find a lead'}
      />

      {audit.review_request_id && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--brand-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--brand)', fontSize: '13px', marginBottom: '16px' }}>
          This is a <b>re-audit</b> for a Review Request. Scoring it and submitting works exactly like any other audit.
        </div>
      )}
      {audit.superseded_by && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--status-green-light, var(--highlight-light))', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--status-green)', fontSize: '13px', marginBottom: '16px' }}>
          This audit was <b>revised</b> — the result below is the revised one. The original scoring is kept, unedited, for history.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px', wordBreak: 'break-all' }}>
            {audit.crm_lead_id ? (
              <a
                href={crmLeadUrl(audit.crm_lead_id)}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                title="Open this lead in the CRM (new tab)"
              >
                {crmLeadUrl(audit.crm_lead_id)} ↗
              </a>
            ) : (
              `Lead #${audit.crm_lead_id}`
            )}
          </h1>
          {isSampleCheck && (
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Special Check — no rubric score
            </span>
          )}
        </div>
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '4px 12px', borderRadius: 'var(--radius-pill)',
          background: 'var(--brand-light)', color: 'var(--brand)', textTransform: 'capitalize',
        }}>
          {audit.status}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px',
        marginBottom: '20px',
      }}>
        <InfoCard title="Agent">
          <div style={{ fontWeight: 600 }}>{agent?.name}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{agent?.email}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{agent?.team_name}</div>
          <div style={{ fontSize: '13px', marginTop: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Vintage: </span>
            <b>{vintage.label}</b>
            {vintage.detail && <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{vintage.detail}</div>}
          </div>
        </InfoCard>
        <InfoCard title="Auditor">
          <div style={{ fontWeight: 600 }}>{auditor?.name}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{auditor?.email}</div>
        </InfoCard>
        <InfoCard title="Call">
          <div style={{ fontSize: '13px' }}>{formatDhakaDateTime(audit.call_started_at)}</div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' }}>
            {audit.call_destination && <span>{audit.call_destination}</span>}
            <CallStatusPill status={audit.call_status} />
          </div>
          <div style={{ fontSize: '13px', marginTop: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Duration: </span>
            <b>{formatCallDuration(audit.call_started_at, audit.call_ended_at)}</b>
          </div>
        </InfoCard>
        <AuditContextCards
          showLead={!!audit.crm_lead_id}
          lead={leadInfo.lead}
          leadUnavailable={leadInfo.unavailable}
          revenue={revenueInfo.revenue}
          revenueNeedsUpdate={revenueInfo.needsUpdate}
        />
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

      {capa && (
        <CapaPanel
          audit={{ id: audit.id, status: audit.status, passed: audit.passed }}
          info={capa}
          canFlag={!!user && (['super_admin', 'qa_manager'].includes(user.role) || (user.role === 'qa_auditor' && isOwner))}
          isDraftOwner={canRelease}
          agentName={agent?.name ?? 'the agent'}
        />
      )}

      <h2 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px' }}>
        {isSampleCheck
          ? (audit.status === 'draft' ? 'Special Check' : 'Special Check result')
          : (audit.status === 'draft' ? 'Scorecard' : 'Result')}
      </h2>

      {isSampleCheck ? (
        audit.status !== 'draft' ? (
          <SampleCheckSummary special={sampleCheck?.special ?? []} saved={sampleCheck?.saved ?? { overall_feedback: audit.overall_feedback ?? '', campaigns: [] }} submittedAt={audit.submitted_at} />
        ) : isOwner ? (
          <SampleCheckForm auditId={audit.id} campaigns={sampleCheck?.special ?? []} savedPayload={sampleCheck?.saved ?? { overall_feedback: '', campaigns: [] }} agentTeam={agent?.team_name ?? null} />
        ) : (
          <div style={{
            background: 'var(--surface-1)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)',
            padding: '20px', color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px',
          }}>
            Special Check in progress — only {auditor?.name} can log it.
          </div>
        )
      ) : !scorecard ? (
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
            score_percent: effective?.scorePercent ?? (audit.score_percent === null ? null : Number(audit.score_percent)),
            passed: effective?.passed ?? audit.passed,
            critical_fail: effective?.criticalFail ?? audit.critical_fail,
            pass_mark_used: effective?.passMarkUsed ?? (audit.pass_mark_used === null ? null : Number(audit.pass_mark_used)),
            submitted_at: effective?.submittedAt ?? audit.submitted_at,
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

      {!isSampleCheck && audit.status !== 'draft' && requestInfo.failed && (
        <div role="alert" style={{ fontSize: '13px', color: 'var(--alert)', marginBottom: '20px' }}>
          The Review Request status could not be loaded right now. This does not mean there is none — reload to check before filing one.
        </div>
      )}
      {!isSampleCheck && audit.status !== 'draft' && !requestInfo.failed && user && (
        <ReviewRequestPanel
          auditId={audit.id}
          auditStatus={audit.status}
          request={requestInfo.request}
          viewer={{ role: user.role, id: user.profile.id }}
          agentName={agent?.name ?? 'the agent'}
          isOwnTeamAgent={user.role === 'team_lead' && agent?.team_leader_id === user.profile.id}
          isOwnChainAgent={false}
          qaStaff={qaStaffOptions}
        />
      )}

      {canRelease && (
        <div style={{ marginTop: '24px' }}>
          <ReleaseDraftButton auditId={audit.id} leadId={audit.crm_lead_id ?? ''} />
        </div>
      )}

      {!isSampleCheck && audit.status !== 'draft' && (
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
