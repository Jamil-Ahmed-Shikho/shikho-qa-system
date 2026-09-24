// ============================================================
// SHIKHO QA AUDIT MANAGEMENT SYSTEM
// Pure CRM-event -> agent_revenue_transactions row mapping (§8).
// No fetch, no Supabase — kept separate from backfill-revenue.mjs and
// the future daily-sync script specifically so this logic is unit
// testable with synthetic fixtures, never against the live CRM.
// ============================================================

/**
 * The CRM sends created_at / updated_at as 'YYYY-MM-DD hh:mm:ss' with NO
 * zone. Evidence they are Dhaka local time, not UTC: read as UTC the loaded
 * events are almost absent 01:00-08:00 and peak at 18:00 (a dead zone
 * across the Dhaka daytime); read as Dhaka time they follow a normal
 * student-purchase day (quiet overnight, evening peak). Postgres would
 * otherwise take a zoneless string as UTC — 6 hours late, pushing every
 * event after 18:00 Dhaka onto the NEXT calendar day and corrupting the
 * Friday/Saturday sales-week boundary. So a zoneless value is pinned to
 * +06:00 here; a value that already carries a zone is left alone.
 * Returns an ISO-8601 string with an explicit offset (or null if blank).
 */
export function crmTimestamp(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const s = String(raw).trim()
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s
  return s.replace(' ', 'T') + '+06:00'
}

export function customField(event, label) {
  const f = (event.custom_field ?? []).find((x) => x.label === label)
  return f ? f.value : null
}

/** Accepts "12,345.00", 12345, "12345" — rejects negative, non-numeric, blank. */
export function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function leadOwnerIdOf(event) {
  return event.lead_owner_id ?? event.lead_owner?.id ?? null
}

/**
 * Maps one CRM /events list item to an agent_revenue_transactions row.
 * Pure — the caller resolves agentId (a CRM lookup + DB match) and passes
 * it in. Returns { row } or { skipped: <reason> }, never throws — bad
 * data from the CRM should be logged and skipped, not crash a live run.
 */
export function mapEventToRow(event, agentId, now = () => new Date().toISOString()) {
  const amount = parseAmount(customField(event, 'cf_amount'))
  if (amount === null) return { skipped: 'cf_amount missing or unparseable' }

  const leadOwnerId = leadOwnerIdOf(event)
  if (leadOwnerId === null || leadOwnerId === undefined) return { skipped: 'no lead_owner_id' }

  if (!event.created_at) return { skipped: 'no created_at' }
  if (!event.updated_at) return { skipped: 'no updated_at' }

  const stamp = now()
  return {
    row: {
      crm_event_id: event.id,
      agent_id: agentId,
      lead_owner_crm_id: leadOwnerId,
      revenue_amount: amount,
      course_name: customField(event, 'cf_course_name') || null,
      crm_lead_prospect_id: event.lead_prospect_id ? String(event.lead_prospect_id) : null,
      purchase_created_at: crmTimestamp(event.created_at),
      crm_updated_at: crmTimestamp(event.updated_at),
      last_synced_at: stamp,
      // schema_023: "the CRM still lists this event" — seen now, so not missing.
      last_seen_at: stamp,
      missing_from_crm_since: null,
    },
  }
}

/** True once a whole page's oldest event predates the cutoff — the backfill's stop condition. */
export function pageIsBeforeCutoff(oldestCreatedAtOnPage, cutoffDate) {
  return new Date(oldestCreatedAtOnPage) < cutoffDate
}

export function monthsAgo(n, from = new Date()) {
  const d = new Date(from)
  d.setMonth(d.getMonth() - n)
  return d
}
