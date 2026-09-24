// ============================================================
// SHIKHO QA AUDIT MANAGEMENT SYSTEM
// Pure CRM-event -> agent_revenue_transactions row mapping (§8).
// No fetch, no Supabase — kept separate from backfill-revenue.mjs and
// the future daily-sync script specifically so this logic is unit
// testable with synthetic fixtures, never against the live CRM.
// ============================================================

// crmTimestamp (zoneless CRM times are Dhaka local) lives in src/lib/crm/time.mjs so
// the app and the scripts share one definition; re-exported here for callers
// that already import it from this module.
import { crmTimestamp } from '../../src/lib/crm/time.mjs'
export { crmTimestamp }

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

/**
 * The backfill's stop rule for id-ordered paging. A lower id can carry a much
 * OLDER date (back-dated events; on 2026-09-24 a bulk import of ~1,000 events
 * dated Feb 2024 sat at July-2026 ids), so ONE old-looking page proves
 * nothing. Stop only after `needed` CONSECUTIVE pages whose newest event is
 * before the cutoff; any page with a newer event resets the count.
 */
export function nextOldPageStreak(streak, newestCreatedAtOnPage, cutoffDate) {
  return pageIsBeforeCutoff(newestCreatedAtOnPage, cutoffDate) ? streak + 1 : 0
}

export function monthsAgo(n, from = new Date()) {
  const d = new Date(from)
  d.setMonth(d.getMonth() - n)
  return d
}
