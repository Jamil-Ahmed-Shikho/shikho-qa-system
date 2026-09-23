import type { OrgNote } from '@/lib/crm/org-sync'

// Informational only — never blocks starting an audit. Shown once above
// the call list (not per call) so an agent with several calls doesn't
// repeat the same warning.
export function OrgSyncBanner({ notes, canManageUsers }: { notes: OrgNote[]; canManageUsers: boolean }) {
  if (notes.length === 0) return null

  return (
    <div style={{
      marginBottom: '16px', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6,
      background: 'var(--highlight-light)', borderLeft: '3px solid var(--highlight)',
      borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', overflowWrap: 'anywhere',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
        Our org data and the CRM disagree
      </div>
      <ul style={{ margin: 0, paddingLeft: '18px' }}>
        {notes.map((n, i) => (
          <li key={i}>
            {n.level === 'team_leader' ? (
              <>
                <b style={{ color: 'var(--text-primary)' }}>{n.subject}</b>: the CRM lists{' '}
                <b style={{ color: 'var(--text-primary)' }}>{n.crmName ?? 'someone'}</b> as their Team Leader;{' '}
                {n.weHaveNone ? 'we have none set.' : <>we have <b style={{ color: 'var(--text-primary)' }}>{n.ourName}</b>.</>}
              </>
            ) : (
              <>
                <b style={{ color: 'var(--text-primary)' }}>{n.subject}</b>{n.onBehalfOf ? ` (Team Leader of ${n.onBehalfOf})` : ''}: the CRM
                lists <b style={{ color: 'var(--text-primary)' }}>{n.crmName ?? 'someone'}</b> as their Manager;{' '}
                {n.weHaveNone ? 'we have no Manager set.' : <>we have <b style={{ color: 'var(--text-primary)' }}>{n.ourName}</b>.</>}
              </>
            )}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
        For information only — this doesn&apos;t affect the audit.
        {canManageUsers && (
          <> · <a href="/admin/users" style={{ color: 'var(--brand)', fontWeight: 600 }}>Review in Users</a></>
        )}
      </div>
    </div>
  )
}
