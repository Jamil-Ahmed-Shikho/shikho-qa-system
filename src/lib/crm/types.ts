// ============================================================
// SHIKHO QA SYSTEM — CRM API types (§10)
// Confirmed response shape for calling-histories items, from the
// tech team's reference code (not a guess).
// ============================================================

export interface CrmCallCreatedBy {
  id: number
  // A DISPLAY NAME (e.g. "First Last"), not the email — an earlier note here
  // said otherwise and was wrong. The email comes from GET /users/{id}
  // (getCrmUser in client.ts). The live object also has status_id/deleted_at.
  name: string
  joining_date?: string
}

export interface CrmCallLead {
  id: number
  name?: string
  phone?: string
  class?: string
  passing_year?: string
  group?: string
  stage?: string
  source?: string
  distribution_list?: { name: string }
}

export interface CrmCallingHistory {
  id: number
  lead_id: number
  started_at: string
  ended_at: string
  recording_url: string
  call_status: string
  created_at: string
  created_by: CrmCallCreatedBy
  // The live API returns `destination_number`; `destination` is what the
  // original sample showed. Either may be present.
  destination?: string
  destination_number?: string
  duration?: number // seconds
  hangup_by?: string
  lead: CrmCallLead
}

// A row from GET /events (§8 revenue sync). The list response carries the
// full custom_field data — no per-event detail fetch is ever needed.
export interface CrmEvent {
  id: number
  type: string
  /** 'YYYY-MM-DD hh:mm:ss', zoneless — Dhaka local time (see crmTimestamp in scripts/lib/revenue-mapping.mjs). */
  created_at: string
  updated_at: string
  lead_owner_id?: number | null
  lead_owner?: { id: number; name?: string | null } | null
  lead_prospect_id?: string | null
  custom_field?: { label: string; value: unknown }[] | null
}
