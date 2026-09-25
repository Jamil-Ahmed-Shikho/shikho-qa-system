import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { FeedbackForm } from '@/components/pip/FeedbackForm'
import { AddTrainingForm, TrainingRowActions } from '@/components/pip/TrainingControls'
import { SchemaMissing, isMissingPipSchema } from '@/components/pip/SchemaMissing'
import { StatusBadge, card, fmtDate, fmtMoney, td, th } from '@/components/pip/pip-display'
import { loadCandidate } from '@/lib/pip/pip.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

export default async function PipDetailPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params
  const [user, loaded] = await Promise.all([
    getAuthUser(),
    loadCandidate(candidateId).catch((err) => { if (!isMissingPipSchema(err)) console.error(err); return err as Error }),
  ])

  if (loaded instanceof Error) {
    return (
      <div>
        <BackLink href="/pip" label="All PIPs" />
        {isMissingPipSchema(loaded) ? <SchemaMissing /> : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>This PIP could not be loaded right now. This does not mean it is empty — try again shortly.</div>
        )}
      </div>
    )
  }
  if (!loaded) notFound()
  const { candidate: c, feedback, trainings } = loaded

  const role = user?.role ?? ''
  const isQa = ['super_admin', 'qa_manager', 'qa_auditor'].includes(role)
  const isAdmin = ['super_admin', 'qa_manager'].includes(role)
  const canGiveFeedback = role === 'team_lead' && c.status !== 'suggested' && c.status !== 'excluded'
  const canAddTraining = isQa && c.status === 'approved'
  const backHref = isAdmin ? `/admin/pip/${c.cycleId}` : '/pip'
  const nextNumber = trainings.length ? Math.max(...trainings.map((t) => t.sessionNumber)) + 1 : 1

  return (
    <div style={{ maxWidth: '900px' }}>
      <BackLink href={backHref} label={isAdmin ? 'PIP cycle' : 'All PIPs'} />
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>{c.agentName}</h1>
        <StatusBadge status={c.status} />
      </div>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {c.teamName ?? '—'} · {c.siteName ?? '—'} · PIP {fmtDate(c.cycleStart)} – {fmtDate(c.cycleEnd)}
        {isQa && <> · revenue at selection {fmtMoney(c.revenue, c.revenueUnit)}</>}
      </p>

      {c.decisionNote && <div style={{ ...card, marginBottom: '16px', fontSize: '13px' }}><b>Outcome note:</b> {c.decisionNote}{c.incentiveDowngraded && <span style={{ color: 'var(--alert)' }}> · Incentive downgraded</span>}</div>}

      <section style={{ ...card, marginBottom: '16px' }} aria-label="Team Leader feedback">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>Team Leader feedback</h2>
        {feedback.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: canGiveFeedback ? '14px' : 0 }}>No feedback recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: canGiveFeedback ? '16px' : 0 }}>
            {feedback.map((f) => (
              <div key={f.id} style={{ borderLeft: '3px solid var(--brand)', paddingLeft: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{f.teamLeaderName ?? 'Team Leader'} · {formatDhakaDateTime(f.createdAt)}</div>
                <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.feedback}</div>
              </div>
            ))}
          </div>
        )}
        {canGiveFeedback && <FeedbackForm candidateId={c.id} />}
        {!canGiveFeedback && role === 'team_lead' && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Feedback opens once the PIP is approved.</div>}
      </section>

      <section style={card} aria-label="Training sessions">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>Training sessions</h2>
        {trainings.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: canAddTraining ? '14px' : 0 }}>No sessions yet.</div>
        ) : (
          <div style={{ overflowX: 'auto', marginBottom: canAddTraining ? '16px' : 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
              <thead><tr><th style={th}>#</th><th style={th}>When</th><th style={th}>Conducted by</th><th style={th}>Status</th>{isQa && <th style={th} />}</tr></thead>
              <tbody>
                {trainings.map((t) => (
                  <tr key={t.id}>
                    <td style={td}>{t.sessionNumber === 1 ? '1 (pre-PIP)' : t.sessionNumber}</td>
                    <td style={td}>{formatDhakaDateTime(t.scheduledAt)}{t.notes && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{t.notes}</div>}</td>
                    <td style={td}>{t.conductedByName ?? <span style={{ color: 'var(--text-muted)' }}>QA team</span>}</td>
                    <td style={td}>{t.status === 'completed' ? (t.attended ? 'Attended' : 'Did not attend') : t.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</td>
                    {isQa && <td style={td}><TrainingRowActions trainingId={t.id} candidateId={c.id} status={t.status} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canAddTraining && <AddTrainingForm candidateId={c.id} nextNumber={nextNumber} />}
        {isQa && !canAddTraining && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sessions can be added while the PIP is approved and running.</div>}
      </section>
    </div>
  )
}
