// ============================================================
// SHIKHO QA SYSTEM — CRM API client (§10)
// Server-only — never import this into a 'use client' component;
// it reads CRM_BEARER_TOKEN, which must never reach the browser.
//
// Mirrors the Shikho CMS's proven CRM integration
// (shikho-cms/src/app/api/crm/lookup/route.ts) — same CRM, same API:
//   - CRM_API_BASE is the domain root; every path here starts /api/v1
//   - Authorization: Bearer <token>, Accept: application/json,
//     X-Log-Ref-Id generated fresh per request (see buildLogRefId)
//   - List endpoints wrap results in { data: [...] }; single-record
//     endpoints return the raw object
//   - 5s timeout, log status + body on failure
// ============================================================

import { cache } from 'react'
import type { CrmCallingHistory, CrmEvent } from './types'

class CrmApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'CrmApiError'
  }
}

/**
 * X-Log-Ref-Id, in the CRM's required shape
 * `{serviceName}-{clientName}-{userId}-{timestamp}`
 * (its own example: `crm-web-240-273492392`).
 *
 * The CRM checks only that there are exactly FOUR hyphen-separated parts,
 * so the userId slot must contain no hyphens — a raw UUID (four hyphens)
 * turns it into eight parts and the CRM answers 400. We put the signed-in
 * user's id there with the hyphens stripped, so a CRM-side log line for a
 * customer's calls or recording traces back to the QA person who opened
 * them (users.id = audits.auditor_id / audit_log.actor_id).
 *
 * `null` = no signed-in user behind the request (a system job).
 */
export function buildLogRefId(actorId: string | null, now: number = Date.now()): string {
  const userSlot = actorId?.replace(/[^A-Za-z0-9]/g, '') || 'system'
  return `shikho-qa-${userSlot}-${now}`
}

function crmHeaders(actorId: string | null) {
  return {
    Authorization: `Bearer ${process.env.CRM_BEARER_TOKEN}`,
    Accept: 'application/json',
    'X-Log-Ref-Id': buildLogRefId(actorId),
  }
}

function baseUrl() {
  const base = process.env.CRM_API_BASE
  if (!base) throw new CrmApiError('CRM_API_BASE is not configured.')
  // Tolerate a base that already ends in /api/v1 so a misconfigured
  // env var doesn't silently double the prefix.
  return base.replace(/\/$/, '').replace(/\/api\/v1$/, '')
}

async function crmFetch<T>(path: string, actorId: string | null, timeoutMs = 5000): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    headers: crmHeaders(actorId),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('CRM API error:', res.status, path, body)
    throw new CrmApiError(`CRM API returned ${res.status}`, res.status)
  }

  return res.json()
}

// The search/conditions/join convention is the one the CMS uses for
// /leads and /events; confirmed working against /calling-histories.
//
// `actorId` (users.id of whoever triggered the request, or null for a
// system job) is required on purpose: it forces every caller to say who
// the CRM's log line should be attributed to.
export async function getCallsForLead(leadId: number, actorId: string | null): Promise<CrmCallingHistory[]> {
  const query =
    `?search=lead_id:${leadId}` +
    `&conditions=lead_id:=` +
    `&join=and&page=1&orderBy=created_at&sortedBy=desc`

  const body = await crmFetch<{ data?: CrmCallingHistory[] }>(`/calling-histories${query}`, actorId)
  return body.data ?? []
}

export async function getCallById(callId: string | number, actorId: string | null): Promise<CrmCallingHistory | null> {
  const call = await crmFetch<CrmCallingHistory | null>(`/calling-histories/${callId}`, actorId)
  return call && typeof call === 'object' ? call : null
}

/**
 * The Dhaka calendar date `days` days before `now` (YYYY-MM-DD) — the lower
 * bound of the daily sync's window. Dhaka has no DST, so a fixed +6h shift is exact.
 */
export function windowStartDate(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + 6 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * One page of purchase events from the last `days` days INCLUDING today,
 * newest first (§8 daily revenue sync). Uses `created_at:<date>` with the
 * `>` operator (events after midnight, Dhaka, of that date) — confirmed live
 * 2026-09-25. The CRM's `last_n_days` filter was tried first and is WRONG for
 * this job: it silently excludes the current day, so a run at 04:00 never saw
 * the previous day's newest events (newest returned: 23 Sep 23:28 while events
 * existed up to 25 Sep 01:37). Other operators (`>=`, `gte`) are ignored by
 * the API, i.e. return everything — do not use them. Both event types, same
 * multi-type `type:in` syntax as the backfill. A 500-row page takes ~4-8s, so
 * this uses a longer timeout than the 5s default and retries transient
 * failures (timeout / network / 5xx — never a 4xx such as an expired token).
 * Page-number paging is fine here: a 15-day window is only a few pages.
 */
export async function getEventsWindow(
  days: number,
  page: number,
  limit: number,
  actorId: string | null,
  sleepMs: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<CrmEvent[]> {
  const query =
    `?search=created_at:${windowStartDate(days)};type:shikho_purchase_completed,installment_enrollment` +
    `&conditions=created_at:%3E;type:in` +
    `&join=and&page=${page}&limit=${limit}&orderBy=created_at&sortedBy=desc`
  for (let attempt = 1; ; attempt++) {
    try {
      const body = await crmFetch<{ data?: CrmEvent[] }>(`/events${query}`, actorId, 30000)
      return body.data ?? []
    } catch (err) {
      const status = err instanceof CrmApiError ? err.status : undefined
      const transient = status === undefined || status >= 500
      if (!transient || attempt >= 3) throw err
      await sleepMs(attempt * 3000)
    }
  }
}

/** The few lead fields the audit page shows. The full profile also carries contact details we deliberately don't keep. */
export interface CrmLeadSummary {
  /** Contact stage — the lead's CURRENT stage in the CRM, not as it was at the time of the call. */
  stage: string | null
  /** Distribution list — the lead's latest (`last_dist_name`); often empty. */
  distributionList: string | null
}

/**
 * GET /leads/{id} reduced to what the audit page shows. Returns null if the
 * CRM has no such lead; other failures (CRM down, timeout) throw, so the
 * caller can say "couldn't load" instead of implying the lead has no data.
 */
export async function getLeadSummary(leadId: string | number, actorId: string | null): Promise<CrmLeadSummary | null> {
  let raw: unknown
  try {
    raw = await crmFetch<unknown>(`/leads/${leadId}`, actorId)
  } catch (err) {
    if (err instanceof CrmApiError && err.status === 404) return null
    throw err
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lead = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const stage = lead.lead_stage && typeof lead.lead_stage === 'object' ? text((lead.lead_stage as Record<string, unknown>).name) : text(lead.lead_stage)
  return { stage, distributionList: text(lead.last_dist_name) }
}

export interface CrmUser {
  id: number
  name: string | null
  email: string | null
  employee_id: string | null
  /** Who the CRM says this person reports to: an agent's Team Leader, a Team Leader's Manager. No email here — look that person up. */
  reporting_to: { id: number; name: string | null } | null
}

/**
 * A CRM user by id — the only place the CRM exposes an agent's EMAIL.
 * A call's `created_by` carries just { id, name (a display name),
 * status_id, deleted_at }; matching a call to one of our users has to go
 * through this lookup (email is the CRM login and our users.email).
 *
 * Returns null if the CRM has no such user. Other failures (CRM down,
 * timeout) throw, so callers can tell "no such person" from "couldn't
 * check". Only the fields we need are kept — the record also carries a
 * phone number and other personal details we have no use for.
 *
 * `cache` de-duplicates identical lookups within one page render (a call
 * list repeats the same agent on many rows).
 */
export const getCrmUser = cache(async (userId: number, actorId: string | null): Promise<CrmUser | null> => {
  let raw: unknown
  try {
    raw = await crmFetch<unknown>(`/users/${userId}`, actorId)
  } catch (err) {
    if (err instanceof CrmApiError && err.status === 404) return null
    throw err
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const rt = r.reporting_to
  const reportingId = Number(
    (rt && typeof rt === 'object' ? (rt as Record<string, unknown>).id : undefined) ?? r.reporting_user_id
  )
  return {
    id: Number(r.id ?? userId),
    name: text(r.name),
    email: text(r.email)?.toLowerCase() ?? null,
    employee_id: text(r.employee_id) ?? (typeof r.employee_id === 'number' ? String(r.employee_id) : null),
    reporting_to: Number.isFinite(reportingId) && reportingId > 0
      ? { id: reportingId, name: rt && typeof rt === 'object' ? text((rt as Record<string, unknown>).name) : null }
      : null,
  }
})

export { CrmApiError }
