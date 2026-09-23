'use client'

import { useState, useTransition } from 'react'
import { isThursday, formatSlotDay, formatSlotTime } from '@/lib/briefings/rules'
import {
  cancelBriefingAction,
  loadSchedulerDataAction,
  markAttendanceAction,
  rescheduleBriefingAction,
  scheduleBriefingAction,
} from '@/lib/briefings/actions'
// Type-only — erased at compile time, never bundled into the client.
import type { loadSchedulerData } from '@/lib/briefings/briefings.service'

type SchedulerData = Awaited<ReturnType<typeof loadSchedulerData>>

const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', fontSize: '13px', fontWeight: 600, color: 'white',
  background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
  background: 'var(--paper)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
}

export function ScheduleCoaching({ auditId, canSchedule, criticalFail }: { auditId: string; canSchedule: boolean; criticalFail: boolean }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<SchedulerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [dayIndex, setDayIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!canSchedule) return null

  async function loadAndOpen() {
    setOpen(true)
    setLoading(true)
    setError(null)
    const res = await loadSchedulerDataAction(auditId)
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setData(res.data)
    setDayIndex(0)
  }

  function pickSlot(iso: string) {
    if (isThursday(new Date(iso))) {
      if (!confirm('Are you sure you want to schedule on Thursday? It tends to be a busy day.')) return
    }
    setError(null)
    startTransition(async () => {
      const isReschedule = !!data?.existing
      const res = isReschedule ? await rescheduleBriefingAction(auditId, iso) : await scheduleBriefingAction(auditId, iso)
      if (!res.ok) return setError(res.error)
      setNotice(
        res.emailSent
          ? `Coaching session ${isReschedule ? 'rescheduled' : 'scheduled'} — the agent (and their Team Leader) have been emailed.`
          : `Coaching session ${isReschedule ? 'rescheduled' : 'scheduled'}, but the email could not be sent.`
      )
      setOpen(false)
    })
  }

  function cancel() {
    if (!confirm('Cancel this coaching session? The agent and their Team Leader will be notified.')) return
    startTransition(async () => {
      const res = await cancelBriefingAction(auditId)
      if (!res.ok) return setError(res.error)
      setNotice('Coaching session cancelled.')
      setOpen(false)
    })
  }

  function mark(attended: boolean) {
    startTransition(async () => {
      const res = await markAttendanceAction(auditId, attended)
      if (!res.ok) return setError(res.error)
      setNotice(attended ? 'Marked attended.' : 'Marked no-show.')
      setOpen(false)
    })
  }

  const existing = data?.existing ?? null
  const scheduledPast = existing && new Date(existing.scheduledAt).getTime() <= Date.now()

  return (
    <div style={{ marginTop: '16px' }}>
      {criticalFail && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px', fontSize: '13px', color: 'var(--alert)', fontWeight: 600, marginBottom: '10px',
        }}>
          URGENT — critical fatal error. This audit needs same-day coaching where possible.
        </div>
      )}

      {notice && (
        <div style={{ background: '#E5F5EC', border: '1px solid var(--status-green)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13px', marginBottom: '10px' }}>
          {notice}
        </div>
      )}

      <button style={primaryBtn} onClick={loadAndOpen}>Schedule Coaching?</button>

      {open && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,19,34,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
          onClick={(e) => { if (e.target === e.currentTarget && !pending) setOpen(false) }}
        >
          <div style={{ width: '100%', maxWidth: '640px', background: 'var(--paper)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Coaching session</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            {error && (
              <div style={{ background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13px', color: 'var(--alert)', marginBottom: '14px' }}>
                {error}
              </div>
            )}

            {loading && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading available slots…</p>}

            {!loading && data && (
              <>
                {existing && existing.status !== 'cancelled' && (
                  <div style={{ background: 'var(--surface-0)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: '16px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {formatSlotDay(new Date(existing.scheduledAt))} · {formatSlotTime(new Date(existing.scheduledAt))}
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      Status: {existing.status}{existing.status === 'completed' && existing.attended !== null ? ` (${existing.attended ? 'attended' : 'no-show'})` : ''}
                      {!existing.isMine && ' · booked by another QA staff member'}
                    </div>
                    {existing.status === 'scheduled' && existing.isMine && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <button style={ghostBtn} disabled={pending} onClick={cancel}>Cancel session</button>
                        {scheduledPast && (
                          <>
                            <button style={{ ...primaryBtn, background: 'var(--status-green)' }} disabled={pending} onClick={() => mark(true)}>Mark attended</button>
                            <button style={{ ...primaryBtn, background: 'var(--alert)' }} disabled={pending} onClick={() => mark(false)}>Mark no-show</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(!existing || existing.status === 'cancelled' || (existing.status === 'scheduled' && existing.isMine)) && (
                  <>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                      {existing?.status === 'scheduled' ? 'Pick a new slot to reschedule into:' : 'Pick a slot from your own coaching grid (11:00 AM-3:00 PM, Sun-Thu):'}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', marginBottom: '12px', paddingBottom: '4px' }}>
                      {data.days.map((d, i) => (
                        <button
                          key={d.dayLabel}
                          onClick={() => setDayIndex(i)}
                          style={{
                            ...ghostBtn, whiteSpace: 'nowrap',
                            ...(i === dayIndex ? { background: 'var(--brand)', color: 'white', borderColor: 'var(--brand)' } : {}),
                          }}
                        >
                          {formatSlotDay(new Date(d.dayLabel))}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                      {data.days[dayIndex]?.slots.map((s) => (
                        <button
                          key={s.iso}
                          disabled={s.taken || pending}
                          onClick={() => pickSlot(s.iso)}
                          style={{
                            ...ghostBtn,
                            ...(s.taken ? { background: 'var(--surface-1)', color: 'var(--text-muted)', cursor: 'not-allowed' } : {}),
                          }}
                        >
                          {formatSlotTime(new Date(s.iso))}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
