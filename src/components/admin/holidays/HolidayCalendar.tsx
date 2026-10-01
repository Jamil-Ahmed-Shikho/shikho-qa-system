'use client'

import { useMemo, useState, useTransition } from 'react'
import type { HolidayRow } from '@/lib/holidays/holidays.service'
import { addHolidayAction, removeHolidayAction } from '@/lib/holidays/actions'

const SITE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'All sites' },
  { value: 'Dhaka', label: 'Dhaka' },
  { value: 'Jashore', label: 'Jashore' },
]

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const field: React.CSSProperties = {
  padding: '8px 10px', fontSize: '14px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid',
  borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit', width: '100%',
}
const label: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 500, margin: '0 0 4px', color: 'var(--text-muted)' }

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function monthLabel(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** True when `date` (YYYY-MM-DD, Dhaka calendar) falls in the sales week [weekStart, weekStart+7). */
function inSalesWeekOf(date: string, today: string): boolean {
  // Sales week starts Saturday; find this week's Saturday for `today`, Dhaka-naive (date-only comparison is fine here).
  const t = new Date(`${today}T00:00:00Z`)
  const dow = t.getUTCDay() // Sun=0..Sat=6
  const daysSinceSat = (dow + 1) % 7
  const weekStart = new Date(t.getTime() - daysSinceSat * 86400000)
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)
  const d = new Date(`${date}T00:00:00Z`)
  return d >= weekStart && d < weekEnd
}

export function HolidayCalendar({ holidays }: { holidays: HolidayRow[] }) {
  const today = new Date()
  const [year, setYear] = useState(today.getUTCFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState<string | null>(null)
  const [site, setSite] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rows, setRows] = useState(holidays)

  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const byDate = useMemo(() => {
    const m = new Map<string, HolidayRow[]>()
    for (const h of rows) {
      const list = m.get(h.date) ?? []
      list.push(h)
      m.set(h.date, list)
    }
    return m
  }, [rows])

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(year, month, 1))
    const firstWeekday = first.getUTCDay() // Sun=0
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [year, month])

  function goMonth(delta: number) {
    let m = month + delta
    let y = year
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setMonth(m); setYear(y); setSelected(null); setMsg(null)
  }

  function pickDate(d: number) {
    setSelected(ymd(year, month, d))
    setName(''); setNote(''); setSite(null); setMsg(null)
  }

  const selectedList = selected ? (byDate.get(selected) ?? []) : []
  const takenSites = new Set(selectedList.map((h) => h.siteName))
  const availableSiteOptions = SITE_OPTIONS.filter((s) => !takenSites.has(s.value))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setMsg(null)
    if (!name.trim()) { setMsg({ ok: false, text: 'Give the holiday a name.' }); return }
    start(async () => {
      const res = await addHolidayAction({ date: selected, name, note: note || null, site })
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
      setRows((prev) => [...prev, { id: res.id, date: selected, name: name.trim(), note: note.trim() || null, siteName: site, createdAt: new Date().toISOString() }])
      setName(''); setNote(''); setSite(null)
      setMsg({ ok: true, text: 'Holiday added.' })
    })
  }

  function remove(id: string) {
    setMsg(null)
    start(async () => {
      const res = await removeHolidayAction(id)
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
      setRows((prev) => prev.filter((r) => r.id !== id))
      setMsg({ ok: true, text: 'Removed.' })
    })
  }

  // Upcoming list (next 90 days), for a plain scannable view alongside the grid.
  const upcoming = useMemo(() => {
    const cutoff = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    return rows.filter((h) => h.date >= todayStr && h.date <= cutoff).sort((a, b) => a.date.localeCompare(b.date))
  }, [rows, todayStr])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '20px', alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <button type="button" onClick={() => goMonth(-1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', cursor: 'pointer', fontSize: '14px' }}>‹ Prev</button>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>{monthLabel(year, month)}</div>
          <button type="button" onClick={() => goMonth(1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', cursor: 'pointer', fontSize: '14px' }}>Next ›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>{w}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {grid.map((d, i) => {
            if (d === null) return <div key={i} />
            const dateStr = ymd(year, month, d)
            const entries = byDate.get(dateStr) ?? []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selected
            const isCurrentSalesWeek = inSalesWeekOf(dateStr, todayStr)
            return (
              <button
                key={i}
                type="button"
                onClick={() => pickDate(d)}
                style={{
                  minHeight: '64px', padding: '6px', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left',
                  border: isSelected ? '2px solid var(--brand)' : isToday ? '1px solid var(--brand)' : '1px solid var(--border)',
                  background: entries.length > 0 ? 'var(--alert-light, #FDEAEE)' : isCurrentSalesWeek ? 'var(--surface-0)' : 'var(--paper)',
                  display: 'flex', flexDirection: 'column', gap: '2px',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: isToday ? 700 : 500 }}>{d}</span>
                {entries.slice(0, 2).map((h) => (
                  <span key={h.id} style={{ fontSize: '10px', color: 'var(--alert)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.siteName ? `${h.siteName}: ` : ''}{h.name}
                  </span>
                ))}
                {entries.length > 2 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{entries.length - 2} more</span>}
              </button>
            )
          })}
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '12px 0 0' }}>
          The shaded week is the current sales week (Sat–Fri) — a holiday marked there adjusts this week&apos;s live
          audit targets; any other week is stored for when it arrives.
        </p>

        {upcoming.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 8px' }}>Upcoming (next 90 days)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {upcoming.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-0)' }}>
                  <span style={{ minWidth: '92px', color: 'var(--text-muted)' }}>{h.date}</span>
                  <span style={{ fontWeight: 600 }}>{h.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{h.siteName ?? 'All sites'}</span>
                  <button type="button" onClick={() => remove(h.id)} disabled={pending}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--alert)', cursor: 'pointer', fontSize: '12px' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--border)', position: 'sticky', top: '16px' }}>
        {!selected ? (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Click a date on the calendar to mark it as a holiday, or manage one already set.</div>
        ) : (
          <>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>{selected}</div>

            {selectedList.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                {selectedList.map((h) => (
                  <div key={h.id} style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-0)', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '8px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{h.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{h.siteName ?? 'All sites'}</div>
                        {h.note && <div style={{ fontSize: '12px', marginTop: '4px' }}>{h.note}</div>}
                      </div>
                      <button type="button" onClick={() => remove(h.id)} disabled={pending}
                        style={{ background: 'none', border: 'none', color: 'var(--alert)', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {availableSiteOptions.length > 0 ? (
              <form onSubmit={submit}>
                <div style={{ marginBottom: '10px' }}>
                  <label style={label} htmlFor="h-site">Applies to</label>
                  <select id="h-site" style={field} value={site ?? ''} onChange={(e) => setSite(e.target.value || null)}>
                    {availableSiteOptions.map((s) => (
                      <option key={s.label} value={s.value ?? ''}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={label} htmlFor="h-name">Name</label>
                  <input id="h-name" style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid-ul-Fitr" maxLength={100} />
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <label style={label} htmlFor="h-note">Note (optional)</label>
                  <textarea id="h-note" style={{ ...field, minHeight: '60px', resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </div>
                <button type="submit" disabled={pending}
                  style={{ width: '100%', padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '14px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
                  {pending ? 'Saving…' : 'Add holiday'}
                </button>
              </form>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Every site already has a holiday marked on this date.</div>
            )}
          </>
        )}

        {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: '12px', marginTop: '10px', color: msg.ok ? 'var(--status-green)' : 'var(--alert)' }}>{msg.text}</div>}
      </div>
    </div>
  )
}
