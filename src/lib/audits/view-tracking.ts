// ============================================================
// SHIKHO QA SYSTEM — evaluation-email click tracking (2026-10-12).
// The email's "I've seen this" button (and the plain portal link beside it,
// 2026-10-14) route through /api/audits/[id]/view?t=<token> before landing
// on /my-audits/{id}. The
// token is an HMAC of the audit id, derived from the service-role key (no
// new secret to add/deploy) — it authorizes nothing sensitive, it only lets
// the redirect route tell "a real emailed link" apart from someone guessing
// a URL, so a stray/malicious hit doesn't inflate the view count. No
// expiry: there's no reason a click weeks later shouldn't still count.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase/server'

function signingSecret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign audit view-tracking links.')
  return key
}

export function signAuditViewToken(auditId: string): string {
  return createHmac('sha256', signingSecret()).update(`audit-result-view:${auditId}`).digest('base64url')
}

export function verifyAuditViewToken(auditId: string, token: string): boolean {
  if (!token) return false
  const expected = Buffer.from(signAuditViewToken(auditId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Records a click-through — idempotent, safe to call on every click including repeats.
 *  Never throws into the caller: a tracking failure must never block the agent from reaching
 *  their result, so the redirect route swallows this itself; this function still logs loudly. */
export async function recordAuditResultView(auditId: string): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.rpc('record_audit_result_view', { p_audit_id: auditId })
  if (error) throw new Error(`Could not record the audit result view: ${error.message}`)
}
