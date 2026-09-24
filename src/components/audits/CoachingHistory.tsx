import { formatSlotDay, formatSlotTime, relativeDayLabel } from '@/lib/briefings/rules'
import type { CoachingHistoryItem } from '@/lib/briefings/briefings.service'
import { splitHistory } from '@/lib/briefings/history'

function when(iso: string, now: Date) {
  const d = new Date(iso)
  return `${formatSlotDay(d)} · ${formatSlotTime(d)} (${relativeDayLabel(d, now)})`
}

function outcome(h: CoachingHistoryItem): { text: string; color: string } {
  if (h.status === 'completed') {
    return h.attended
      ? { text: 'attended', color: 'var(--status-green)' }
      : { text: 'did not attend', color: 'var(--alert)' }
  }
  return { text: 'attendance not recorded yet', color: 'var(--text-muted)' }
}

/**
 * The agent's coaching at a glance, for whoever is about to schedule: is a
 * session already booked (and with whom), and when was the last one. Warn,
 * don't block — the scheduler decides.
 */
export function CoachingHistory({
  items,
  currentAuditId,
  unavailable = false,
}: {
  items: CoachingHistoryItem[] | null
  /** The audit being scheduled — its own booking isn't a "second" session. */
  currentAuditId: string
  /** The history could not be loaded — say so rather than imply there is none. */
  unavailable?: boolean
}) {
  const box: React.CSSProperties = {
    background: 'var(--surface-0)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '12px 14px', fontSize: '13px', lineHeight: 1.6,
  }

  if (unavailable || items === null) {
    return (
      <div style={{ ...box, color: 'var(--text-muted)' }}>
        Coaching history could not be loaded right now — check whether this agent already has a session before booking.
      </div>
    )
  }

  const now = new Date()
  const { upcoming, past } = splitHistory(items, now)
  const last = past[0]

  return (
    <div style={box} aria-label="Coaching history">
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
        Coaching history
      </div>

      {upcoming.map((h) => (
        <div
          key={h.briefingId}
          style={{
            background: 'var(--highlight-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)',
            borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: '8px', color: 'var(--text-primary)',
          }}
        >
          <b>{h.auditId === currentAuditId ? 'Already scheduled for this audit' : 'Already has an upcoming session'}</b>
          {' — '}{when(h.scheduledAt, now)} with {h.conductorName}
          {h.priority === 'critical_same_day' && <span style={{ color: 'var(--alert)', fontWeight: 600 }}> · urgent (critical fatal)</span>}
        </div>
      ))}
      {upcoming.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>No upcoming session scheduled.</div>
      )}

      {last ? (
        <div style={{ color: 'var(--text-secondary)' }}>
          Last session: <b style={{ color: 'var(--text-primary)' }}>{when(last.scheduledAt, now)}</b> with {last.conductorName} —{' '}
          <span style={{ color: outcome(last).color, fontWeight: 600 }}>{outcome(last).text}</span>
          {past.length > 1 && <span style={{ color: 'var(--text-muted)' }}> · {past.length} sessions on record</span>}
        </div>
      ) : (
        <div style={{ color: 'var(--text-secondary)' }}>No past coaching sessions on record for this agent.</div>
      )}
    </div>
  )
}
