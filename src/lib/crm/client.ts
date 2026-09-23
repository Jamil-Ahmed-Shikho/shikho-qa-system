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
import type { CrmCallingHistory } from './types'

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

async function crmFetch<T>(path: string, actorId: string | null): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    headers: crmHeaders(actorId),
    signal: AbortSignal.timeout(5000),
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
