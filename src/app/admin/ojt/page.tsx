import { BackLink } from '@/components/common/BackLink'
import { OjtCandidateActions } from '@/components/admin/ojt/OjtCandidateActions'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { isMissingOjtSchema, loadOjtCandidates, loadOjtHistory, type OjtCandidate, type OjtHistoryRow } from '@/lib/ojt/ojt.service'

const card: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '20px',
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 500 }
const td: React.CSSProperties = { padding: '8px', fontSize: '13px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)', verticalAlign: 'top' }

const dateFmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')

const STAGE_LABEL: Record<string, string> = { ojt: 'OJT', re_training: 'Re-Training' }
const TO_LABEL: Record<string, string> = { active: 'Certified', re_training: 'Re-Training', not_certified: 'Not Certified', discontinued: 'Discontinued' }

function CandidateRow({ c, canAct }: { c: OjtCandidate; canAct: boolean }) {
  return (
    <tr>
      <td style={td}>
        <b>{c.name}</b>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{[c.teamName, c.siteName].filter(Boolean).join(' · ') || c.email}</div>
      </td>
      <td style={td}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: c.stage === 're_training' ? 'var(--highlight)' : 'var(--brand)' }}>{STAGE_LABEL[c.stage]}</span>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.daysInStage !== null ? `${c.daysInStage} day${c.daysInStage === 1 ? '' : 's'}` : ''}</div>
      </td>
      <td style={td}>{c.teamLeaderName ?? '—'}</td>
      <td style={td}>{c.trainerName ?? '—'}</td>
      <td style={td}>
        {c.stage === 'ojt' ? (
          <span>
            <b style={{ color: c.ojtTarget !== null && c.ojtCallsThisWeek >= c.ojtTarget ? 'var(--status-green)' : 'inherit' }}>{c.ojtCallsThisWeek}</b>
            {' / '}{c.ojtTarget ?? '—'} this week
          </span>
        ) : (
          <span>
            {c.reTrainingCallDone ? <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>Call done ✓</span> : <span style={{ color: 'var(--alert)' }}>Call not done yet</span>}
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {dateFmt(c.reTrainingStartDate)} – {dateFmt(c.reTrainingEndDate)}
              {c.reTrainingDaysLeft !== null && ` · ${c.reTrainingDaysLeft} day${c.reTrainingDaysLeft === 1 ? '' : 's'} left`}
            </div>
          </span>
        )}
      </td>
      <td style={td}>{canAct ? <OjtCandidateActions candidate={c} /> : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>View only</span>}</td>
    </tr>
  )
}

function HistoryRow({ h }: { h: OjtHistoryRow }) {
  return (
    <tr>
      <td style={td}>{formatDhakaDateTime(h.changedAt)}</td>
      <td style={td}>{h.agentName}</td>
      <td style={td}>{STAGE_LABEL[h.fromStage] ?? h.fromStage} → {TO_LABEL[h.toStage] ?? h.toStage}</td>
      <td style={td}>{h.changedByName ?? '—'}</td>
      <td style={{ ...td, maxWidth: '260px', whiteSpace: 'pre-wrap' }}>{h.note ?? '—'}</td>
    </tr>
  )
}

export default async function OjtManagementPage() {
  const user = await getAuthUser()
  const canAct = !!user && ['super_admin', 'qa_manager'].includes(user.role)

  let candidates: OjtCandidate[] = []
  let history: OjtHistoryRow[] = []
  let failure: unknown = null
  try {
    ;[candidates, history] = await Promise.all([loadOjtCandidates(), loadOjtHistory()])
  } catch (err) {
    failure = err
    if (!isMissingOjtSchema(err)) console.error(err)
  }

  const ojt = candidates.filter((c) => c.stage === 'ojt')
  const retraining = candidates.filter((c) => c.stage === 're_training')

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>OJT Management</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Everyone currently in On-Job Training or Re-Training. Certify prompts for a joining date; Not Certify and
        Discontinue require a reason. Every change is logged below and can never be edited or deleted.
      </p>

      {failure ? (
        isMissingOjtSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--highlight)', fontSize: '14px' }}>
            <b>The OJT database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_038_ojt_lifecycle.sql</code> in the Supabase SQL Editor, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. This does not mean there is nobody in OJT — try again shortly.</div>
        )
      ) : (
        <>
          <section style={card} aria-label="OJT">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>On-Job Training ({ojt.length})</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Target: 3 audited calls a week, from the admin-configured OJT rule.</p>
            {ojt.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody in OJT.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                  <thead><tr><th style={th}>Candidate</th><th style={th}>Stage</th><th style={th}>Team Lead</th><th style={th}>Trainer</th><th style={th}>Progress</th><th style={th} /></tr></thead>
                  <tbody>{ojt.map((c) => <CandidateRow key={c.agentId} c={c} canAct={canAct} />)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section style={card} aria-label="Re-training">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Re-Training ({retraining.length})</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Target: one audited call across the whole 3-day window, checked off once — not a per-day count.</p>
            {retraining.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody in re-training.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                  <thead><tr><th style={th}>Candidate</th><th style={th}>Stage</th><th style={th}>Team Lead</th><th style={th}>Trainer</th><th style={th}>Progress</th><th style={th} /></tr></thead>
                  <tbody>{retraining.map((c) => <CandidateRow key={c.agentId} c={c} canAct={canAct} />)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section style={card} aria-label="History">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>Recent transitions</h2>
            {history.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No transitions recorded yet.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
                  <thead><tr><th style={th}>When</th><th style={th}>Candidate</th><th style={th}>Change</th><th style={th}>By</th><th style={th}>Note</th></tr></thead>
                  <tbody>{history.map((h) => <HistoryRow key={h.id} h={h} />)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
