import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadBrowsableAgent } from '@/lib/audits/agent-call-browser.service'
import { loadAgentAuditHistory } from '@/lib/agents/agent-profile.service'

const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '10px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }

export default async function AgentAuditHistoryPage({ params }: { params: Promise<{ agentId: string }> }) {
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')
  if (!['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(viewer.role)) redirect('/dashboard')

  const { agentId } = await params
  const agent = await loadBrowsableAgent(agentId)
  if (!agent) {
    return (
      <div>
        <BackLink href="/dashboard" label="Dashboard" />
        <ErrorState message="No such agent." />
      </div>
    )
  }

  let audits: Awaited<ReturnType<typeof loadAgentAuditHistory>> = []
  let failed = false
  try {
    audits = await loadAgentAuditHistory(agentId)
  } catch (err) {
    failed = true
    console.error(err)
  }

  return (
    <div>
      <BackLink href={`/audits/agent/${encodeURIComponent(agentId)}/profile`} label={`${agent.name}'s profile`} />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>{agent.name}&apos;s audits</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>Every submitted audit, most recent first.</p>

      {failed ? (
        <ErrorState message="This agent's audits could not be loaded right now — this does not mean there are none." />
      ) : audits.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>No submitted audits yet.</div>
      ) : (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
            <thead><tr><th style={th}>Submitted</th><th style={th}>Auditor</th><th style={th}>Score</th><th style={th}>Result</th><th style={th} /></tr></thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{formatDhakaDateTime(a.submittedAt)}</td>
                  <td style={td}>{a.auditorName ?? '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{a.scorePercent === null ? '—' : `${a.scorePercent}%`}</td>
                  <td style={{ ...td, color: a.passed ? 'var(--status-green)' : 'var(--alert)', fontWeight: 600 }}>
                    {a.criticalFail ? 'Critical fatal error' : a.passed ? 'Passed' : 'Did not pass'}
                  </td>
                  <td style={td}><Link href={`/audits/${a.id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--alert-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--alert)', fontSize: '14px', color: 'var(--alert)' }}>
      {message}
    </div>
  )
}
