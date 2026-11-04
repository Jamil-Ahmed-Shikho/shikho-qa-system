import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingPortalUsageSchema,
  loadPortalUsage,
  type PortalUsageRow,
  type PortalUsageStatus,
} from '@/lib/portal-usage/portal-usage.service'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)' }
const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})

const STATUS_LABEL: Record<PortalUsageStatus, string> = { active: 'Active', low_usage: 'Low usage', inactive: 'Inactive', never: 'Never logged in' }
const STATUS_COLOR: Record<PortalUsageStatus, string> = { active: 'var(--status-green)', low_usage: 'var(--highlight)', inactive: 'var(--alert)', never: 'var(--text-muted)' }
// Worst-first, so the people most worth a look sit at the top of each group.
const STATUS_RANK: Record<PortalUsageStatus, number> = { never: 0, inactive: 1, low_usage: 2, active: 3 }
const ROLE_LABEL: Record<string, string> = { super_admin: 'Super Admin', qa_manager: 'QA Manager', manager: 'Manager', team_lead: 'Team Lead', qa_auditor: 'QA Auditor' }
const ROLE_RANK: Record<string, number> = { super_admin: 0, qa_manager: 1, manager: 2, team_lead: 3, qa_auditor: 4 }

function StatusBadge({ status }: { status: PortalUsageStatus }) {
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      borderStyle: 'solid', borderWidth: '1px', borderColor: STATUS_COLOR[status], color: STATUS_COLOR[status],
    }}>{STATUS_LABEL[status]}</span>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function activityCells(r: PortalUsageRow) {
  return (
    <>
      <td style={td}>{fmtDate(r.lastActiveDate)}{r.daysSinceActive !== null && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.daysSinceActive === 0 ? 'today' : `${r.daysSinceActive}d ago`}</div>}</td>
      <td style={td}>{r.activeDays7} / 7</td>
      <td style={td}>{r.activeDays30} / 30</td>
      <td style={td}><StatusBadge status={r.status} /></td>
    </>
  )
}

function BackOfficeSection({ rows }: { rows: PortalUsageRow[] }) {
  if (rows.length === 0) return null
  const byRole = new Map<string, PortalUsageRow[]>()
  for (const r of rows) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r])
  const roles = [...byRole.keys()].sort((a, b) => (ROLE_RANK[a] ?? 99) - (ROLE_RANK[b] ?? 99))

  return (
    <div style={card}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Back Office usage</h2>
      <p style={sectionNote}>QA, Team Lead, Manager and Admin accounts — are they actually signing in and using the portal?</p>
      {roles.map((role) => {
        const roleRows = [...byRole.get(role)!].sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || a.name.localeCompare(b.name))
        return (
          <div key={role} style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 6px', color: 'var(--text-secondary)' }}>{ROLE_LABEL[role] ?? role} ({roleRows.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                <thead><tr><th style={th}>Name</th><th style={th}>Team / Site</th><th style={th}>Last active</th><th style={th}>Active (7d)</th><th style={th}>Active (30d)</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {roleRows.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                      <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                      {activityCells(r)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FrontlineSection({ rows }: { rows: PortalUsageRow[] }) {
  if (rows.length === 0) return <div style={card}><p style={empty}>No agents in view right now.</p></div>
  const byLead = new Map<string, PortalUsageRow[]>()
  for (const r of rows) byLead.set(r.teamLeaderName ?? 'No Team Lead on record', [...(byLead.get(r.teamLeaderName ?? 'No Team Lead on record') ?? []), r])
  const leads = [...byLead.keys()].sort((a, b) => a.localeCompare(b))

  return (
    <div style={card}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>Frontline usage</h2>
      <p style={sectionNote}>Agents, grouped by Team Lead — are they actually using the portal (coaching, their own result emails, etc.)?</p>
      {leads.map((lead) => {
        const leadRows = [...byLead.get(lead)!].sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || a.name.localeCompare(b.name))
        return (
          <div key={lead} style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 6px', color: 'var(--text-secondary)' }}>{lead} ({leadRows.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                <thead><tr><th style={th}>Agent</th><th style={th}>QA Auditor</th><th style={th}>Team / Site</th><th style={th}>Last active</th><th style={th}>Active (7d)</th><th style={th}>Active (30d)</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {leadRows.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                      <td style={td}>{r.qualityAuditorName ?? '—'}</td>
                      <td style={td}>{[r.teamName, r.siteName].filter(Boolean).join(' · ') || '—'}</td>
                      {activityCells(r)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function PortalUsagePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let backOffice: PortalUsageRow[] = []
  let frontline: PortalUsageRow[] = []
  let failure: unknown = null
  try {
    ;[backOffice, frontline] = await Promise.all([
      loadPortalUsage('back_office', 'team'), // Back Office has no My/Team toggle (§ confirmed design) — always the caller's own scope
      loadPortalUsage('frontline', view),
    ])
  } catch (err) {
    failure = err
    if (!isMissingPortalUsageSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Portal Usage</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Who&apos;s actually signing in and using this portal — not page-by-page tracking, just whether someone was active on a given day.
        Active = used in the last 3 days. Low usage = 3–13 days since last use. Inactive = 14+ days, or never used.
      </p>

      {isAuditor && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <Link href="/reports/portal-usage?view=mine" aria-current={view === 'mine' ? 'page' : undefined} style={pill(view === 'mine')}>My view</Link>
          <Link href="/reports/portal-usage?view=team" aria-current={view === 'team' ? 'page' : undefined} style={pill(view === 'team')}>Team view</Link>
        </div>
      )}

      {failure ? (
        isMissingPortalUsageSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_109_portal_usage_tracking.sql</code>, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <BackOfficeSection rows={backOffice} />
          <FrontlineSection rows={frontline} />
        </>
      )}
    </div>
  )
}
