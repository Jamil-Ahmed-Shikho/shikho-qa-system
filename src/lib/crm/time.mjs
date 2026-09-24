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
  return s.replace(' ', 'T') + '+06:00'
}

/** A CRM timestamp as a Date (the correct instant), or null. */
export function parseCrmTime(raw) {
  const iso = crmTimestamp(raw)
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
