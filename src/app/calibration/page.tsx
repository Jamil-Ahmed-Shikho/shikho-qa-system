import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { KIND_LABELS } from '@/lib/calibration/validation'
import { isMissingCalibrationSchema, listSessions, type CalibrationSession } from '@/lib/calibration/calibration.service'

const card: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '16px',
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 500 }
const td: React.CSSProperties = { padding: '8px', fontSize: '14px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)', verticalAlign: 'top' }

function Table({ rows }: { rows: CalibrationSession[] }) {
  if (rows.length === 0) return <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>None.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
        <thead><tr><th style={th}>When (Dhaka)</th><th style={th}>Session</th><th style={th}>Scope</th><th style={th}>Scheduled by</th><th style={th} /></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={td}>{formatDhakaDateTime(s.scheduledAt)}</td>
              <td style={td}>
                <b>{s.title ?? (s.itemType === 'call' ? `Call ${s.crmCallId}` : s.itemReference)}</b>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{KIND_LABELS[s.kind]}</div>
              </td>
              <td style={td}>{s.teamName} · {s.siteName}</td>
              <td style={td}>{s.schedulerName ?? 'QA team'}</td>
              <td style={td}><Link href={`/calibration/${s.id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function CalibrationListPage() {
  const user = await getAuthUser()
  const canSchedule = !!user && ['super_admin', 'qa_manager', 'qa_auditor'].includes(user.role)
  let sessions: CalibrationSession[] = []
  let failure: unknown = null
  try {
    sessions = await listSessions()
  } catch (err) {
    failure = err
    if (!isMissingCalibrationSchema(err)) console.error(err)
  }
  const now = Date.now()
  const upcoming = sessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduledAt).getTime() >= now - 3600_000).reverse()
  const past = sessions.filter((s) => !upcoming.includes(s))

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Calibration sessions</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '620px' }}>
            Scheduled sessions where invited people score the same call against the rubric. You only see sessions you take part in.
          </p>
        </div>
        {canSchedule && (
          <Link href="/calibration/new" style={{ padding: '10px 18px', borderRadius: 'var(--radius-md)', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, textDecoration: 'none' }}>
            Schedule a session
          </Link>
        )}
      </div>

      {failure ? (
        isMissingCalibrationSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--highlight)', fontSize: '14px' }}>
            <b>The calibration database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_031_calibration.sql</code> in the Supabase SQL Editor, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Sessions could not be loaded right now. This does not mean there are none — try again shortly.</div>
        )
      ) : (
        <>
          <section style={card} aria-label="Upcoming"><h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Upcoming</h2><Table rows={upcoming} /></section>
          <section style={card} aria-label="Past and cancelled"><h2 style={{ fontSize: '15px', margin: '0 0 8px' }}>Past &amp; cancelled</h2><Table rows={past} /></section>
        </>
      )}
    </div>
  )
}
