// ============================================================
// SHIKHO QA SYSTEM — Date display (Dhaka time)
// Everything staff read is in Bangladesh time. `toLocaleString()` uses
// whatever timezone the machine happens to be in — a browser in Dhaka is
// fine, but a server-rendered page on Vercel (UTC) would print UTC. These
// formatters always say Dhaka.
// ============================================================

import { parseCrmTime } from '@/lib/crm/time.mjs'

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka',
})

/** A real instant (a Date, or an ISO string with a zone — e.g. a timestamptz from the database) in Dhaka time. */
export function formatDhakaDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d)
}

/** A raw CRM timestamp (zoneless Dhaka local time, e.g. a call's started_at) in Dhaka time. */
export function formatCrmDateTime(raw: string | null | undefined): string {
  return formatDhakaDateTime(parseCrmTime(raw))
}
