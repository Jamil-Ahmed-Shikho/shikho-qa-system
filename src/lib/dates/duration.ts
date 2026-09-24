/** A call's length from its start/end instants, e.g. "7m 7s", "45s". A dash if either is missing or unreadable. */
export function formatCallDuration(startedAt: string | Date | null | undefined, endedAt: string | Date | null | undefined): string {
  if (!startedAt || !endedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
