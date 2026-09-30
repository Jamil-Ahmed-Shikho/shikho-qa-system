import { BackLink } from '@/components/common/BackLink'
import { TlCheckTypeForm } from '@/components/admin/tl-checks/TlCheckTypeForm'
import { TlCheckTypeCard } from '@/components/admin/tl-checks/TlCheckTypeCard'
import { isMissingTlCheckSchema, loadAllTlCheckTypes } from '@/lib/team-lead-checks/definitions.service'
import { loadAllTeamLeadChecks } from '@/lib/team-lead-checks/team-lead-checks.service'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export default async function TeamLeadChecksAdminPage() {
  const user = await getAuthUser()
  let types: Awaited<ReturnType<typeof loadAllTlCheckTypes>> = []
  let checks: Awaited<ReturnType<typeof loadAllTeamLeadChecks>> = []
  let failure: unknown = null
  try {
    types = await loadAllTlCheckTypes()
    if (user?.role === 'super_admin') checks = await loadAllTeamLeadChecks()
  } catch (err) {
    failure = err
    if (!isMissingTlCheckSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard/admin" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Team Leader Checks</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        A lightweight, Special-Check-only tool for Team Leads to log a quick check on their own agents&apos; calls —
        no scoring, never affects an agent&apos;s real audit score or RYG status, and never shown on any QA
        Manager / QA Auditor dashboard. Manage the questions Team Leads can answer below.
      </p>

      {failure ? (
        isMissingTlCheckSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_057_team_lead_checks.sql</code> (after 056), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <TlCheckTypeForm />
          {types.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No checks defined yet — add one above.</p>
          ) : (
            types.map((t) => <TlCheckTypeCard key={t.id} type={t} />)
          )}

          {user?.role === 'super_admin' && (
            <div style={{ marginTop: '28px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Every check logged (Admin oversight)</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>The last 100, most recent first — visible to Super Admin only.</p>
              {checks.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody has logged a check yet.</p>
              ) : (
                <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                    <thead>
                      <tr><th style={th}>Team Lead</th><th style={th}>Agent</th><th style={th}>Answers</th><th style={th}>Notes</th><th style={th}>When</th></tr>
                    </thead>
                    <tbody>
                      {checks.map((c) => (
                        <tr key={c.id}>
                          <td style={td}><b>{c.teamLeadName}</b></td>
                          <td style={td}>{c.agentName}</td>
                          <td style={td}>{c.answers.length === 0 ? '—' : c.answers.map((a) => `${a.checkTypeName}: ${a.valueLabel}`).join('; ')}</td>
                          <td style={td}>{c.notes ?? '—'}</td>
                          <td style={td}>{formatDhakaDateTime(c.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
