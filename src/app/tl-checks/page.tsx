import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isMissingTlCheckSchema } from '@/lib/team-lead-checks/definitions.service'
import { loadMyTeamLeadChecks } from '@/lib/team-lead-checks/team-lead-checks.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

export default async function TlChecksLandingPage() {
  const user = await getAuthUser()
  if (!user) redirect('/auth/login')
  if (user.role !== 'team_lead') redirect('/dashboard')

  const supabase = await getSupabaseServer()
  const { data: roster, error } = await supabase
    .from('users').select('id, name, team_name, site_name')
    .eq('team_leader_id', user.profile.id).eq('role', 'agent').eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)

  let recent: Awaited<ReturnType<typeof loadMyTeamLeadChecks>> = []
  let failure: unknown = null
  try {
    recent = await loadMyTeamLeadChecks()
  } catch (err) {
    failure = err
    if (!isMissingTlCheckSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Team Leader Checks</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '640px' }}>
        A quick check on one of your own agents&apos; calls — no scoring, never affects their real audit score.
        Pick an agent to browse their recent calls.
      </p>

      {(roster ?? []).length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No agents are on your team yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '28px' }}>
          {(roster ?? []).map((a) => (
            <a key={a.id} href={`/tl-checks/agent/${a.id}`} style={{
              display: 'block', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
              background: 'var(--paper)', textDecoration: 'none', color: 'inherit', minWidth: '180px',
            }}>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{a.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{[a.team_name, a.site_name].filter(Boolean).join(' · ') || '—'}</div>
            </a>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 10px' }}>Your recent checks</h2>
      {failure ? (
        isMissingTlCheckSchema(failure) ? (
          <div role="alert" style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '13px' }}>
            This database change hasn&apos;t been applied yet.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '13px' }}>Could not be loaded right now.</div>
        )
      ) : recent.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>You haven&apos;t logged a check yet.</p>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
            <thead><tr><th style={th}>Agent</th><th style={th}>Answers</th><th style={th}>Notes</th><th style={th}>When</th></tr></thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td style={td}><b>{c.agentName}</b></td>
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
  )
}
