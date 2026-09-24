// ============================================================
// CRM timestamps (§8, §10). Plain .mjs on purpose: the Next app AND the
// standalone Node scripts (scripts/*.mjs) import this one definition.
// ============================================================

/**
 * The CRM sends created_at / updated_at / started_at / ended_at as zoneless
 * 'YYYY-MM-DD hh:mm:ss' in DHAKA LOCAL time, not UTC. Two independent
 * pieces of evidence:
 *  - revenue events: read as UTC they are almost absent 01:00-08:00 and
 *    peak at 18:00; read as Dhaka time they follow a normal purchase day;
 *  - call recordings: the recorder's own filename timestamp
 *    (server3-...-20260923-043239.mp3) is EXACTLY 6 hours before the CRM's
 *    started_at on every call checked (04:32:39 vs 10:32:40, ...).
 * Left alone, Postgres reads a zoneless string as UTC (6 hours late) and a
 * browser reads it as ITS local time (right only for a browser in Dhaka).
 * So a zoneless value is pinned to +06:00 here; a value that already
 * carries a zone is left alone. Returns an ISO-8601 string with an
 * explicit offset (or null if blank).
 */
export function crmTimestamp(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const s = String(raw).trim()
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s
  return to24Hour(s).replace(' ', 'T') + '+06:00'
}

/**
 * Some CRM endpoints (events, tasks) send the time-of-day in 12-hour form:
 * '2026-09-10 08:13:30 pm'. Postgres reads that correctly but JavaScript's Date
 * does not (Invalid Date), so normalise it to 24-hour here, once, and every
 * consumer — including plain string sorting — gets a valid, orderable value.
 * 12 am is 00, 12 pm is 12. A 24-hour value passes through untouched.
 */
function to24Hour(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(s)
  if (!m) return s
  let h = Number(m[2]) % 12
  if (m[5].toLowerCase() === 'p') h += 12
  return `${m[1]} ${String(h).padStart(2, '0')}:${m[3]}:${m[4] ?? '00'}`
}

/** A CRM timestamp as a Date (the correct instant), or null. */
export function parseCrmTime(raw) {
  const iso = crmTimestamp(raw)
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
