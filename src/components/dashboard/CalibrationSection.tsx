import Link from 'next/link'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { KIND_LABELS } from '@/lib/calibration/validation'
import { isMissingCalibrationSchema, listSessions, type CalibrationSession } from '@/lib/calibration/calibration.service'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px 20px', marginTop: '24px',
}

/**
 * Upcoming calibration sessions the viewer takes part in (§5). The rows are scoped by the database: QA Manager /
 * Super Admin see all, everyone else only sessions they were invited to (a Team Lead never sees any other).
 */
export async function CalibrationSection() {
  let sessions: CalibrationSession[] = []
  try {
    sessions = await listSessions()
  } catch (err) {
    // Before schema_031 is applied the panel simply isn't there; any other failure must not look like "none".
    if (isMissingCalibrationSchema(err)) return null
    console.error(err)
    return (
      <section style={card} aria-label="Calibration sessions">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Calibration sessions</h2>
        <p role="alert" style={{ color: 'var(--alert)', fontSize: '13px', margin: '8px 0 0' }}>
          Could not be loaded — this does not mean there are none.
        </p>
      </section>
    )
  }
  const cutoff = Date.now() - 3600_000
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduledAt).getTime() >= cutoff)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 8)

  return (
    <section style={card} aria-label="Calibration sessions">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Calibration sessions</h2>
        <Link href="/calibration" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none' }}>All sessions</Link>
      </div>
      {upcoming.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0 0' }}>No upcoming sessions.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: '8px' }}>
          {upcoming.map((s) => (
            <li key={s.id} style={{ fontSize: '14px' }}>
              <b>{formatDhakaDateTime(s.scheduledAt)}</b> ·{' '}
              <Link href={`/calibration/${s.id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                {s.title ?? (s.itemType === 'call' ? `Call ${s.crmCallId}` : s.itemReference)}
              </Link>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {s.teamName} · {s.siteName} · {KIND_LABELS[s.kind]} — listen to the recording beforehand and form your own score.
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
