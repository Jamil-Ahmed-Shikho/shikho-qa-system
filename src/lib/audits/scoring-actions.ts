'use server'
// ============================================================
// SHIKHO QA SYSTEM — save / submit a scorecard (§4 step 4)
//
// These take MARKS and the auditor's feedback text (which parameters passed,
// which error attributes were ticked and why, which fatals, the coaching
// summary and any per-parameter notes) — never a score. The database
// function write_audit_results derives every number from the marks and
// enforces the confirmed scoring rule, in one transaction, so a doctored
// request can't submit a score of its own.
//
// Returns { ok, error } objects, not thrown errors (Next.js hides thrown
// messages in production — CLAUDE.md §14).
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import type { AuthUser } from '@/types/database.types'
import { parsePayload, type MarksPayload } from './scoring'

export interface SubmitResult {
  score_percent: number
  passed: boolean
  critical_fail: boolean
  pass_mark: number
  points_earned: number
  points_possible: number
}

type Failure = { ok: false; error: string }

type Prepared =
  | { error: string }
  | { user: AuthUser; audit: { id: string; crm_lead_id: string | null }; payload: MarksPayload }

async function prepare(auditId: string, rawPayload: unknown): Promise<Prepared> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(user.role)) {
    return { error: 'Only QA roles can score an audit.' }
  }

  const parsed = parsePayload(rawPayload)
  if (!parsed.ok) return { error: parsed.error }

  // Loaded as the signed-in user, so row-level security decides they may
  // see this audit at all; then it must be THEIR draft.
  const supabase = await getSupabaseServer()
  const { data: audit } = await supabase
    .from('audits')
    .select('id, auditor_id, status, crm_lead_id')
    .eq('id', auditId)
    .maybeSingle()
  if (!audit) return { error: 'Audit not found.' }
  if (audit.auditor_id !== user.profile.id) return { error: 'Only the auditor who started this audit can score it.' }
  if (audit.status !== 'draft') return { error: 'This audit has already been submitted and can no longer be changed.' }

  return { user, audit: { id: audit.id, crm_lead_id: audit.crm_lead_id }, payload: parsed.payload }
}

// The function's own rules ("Not every parameter has been scored…") are
// raised as ordinary exceptions and are written for the auditor to read;
// anything else (a connection problem…) is not.
function friendly(error: { code?: string; message: string }): string {
  if (error.code === 'P0001') return error.message
  console.error('write_audit_results failed:', error.code, error.message)
  return 'Something went wrong saving the scorecard. Please try again.'
}

async function write(auditId: string, actorId: string, finalize: boolean, p: MarksPayload) {
  return getSupabaseAdmin().rpc('write_audit_results', {
    p_audit_id: auditId,
    p_actor: actorId,
    p_finalize: finalize,
    p_results: p.results,
    p_ticks: p.ticks,
    p_fatals: p.fatals,
    p_overall_feedback: p.overall_feedback,
    // null (an older page) = leave the stored campaign links alone; otherwise the full new state
    p_campaigns: p.campaigns,
  })
}

/** Save the scorecard as it stands (partial is fine) — the audit stays a draft. */
export async function saveScorecardDraft(auditId: string, rawPayload: unknown): Promise<{ ok: true } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { user, audit, payload } = ctx

  const { error } = await write(audit.id, user.profile.id, false, payload)
  if (error) return { ok: false, error: friendly(error) }

  revalidatePath(`/audits/${audit.id}`)
  return { ok: true }
}

/** Score it and submit: draft -> submitted, once, atomically. */
export async function submitScorecard(auditId: string, rawPayload: unknown): Promise<{ ok: true; result: SubmitResult } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { user, audit, payload } = ctx

  const { data, error } = await write(audit.id, user.profile.id, true, payload)
  if (error) return { ok: false, error: friendly(error) }
  const result = data as SubmitResult

  await writeAuditLogs([{
    actor_id: user.profile.id,
    action: 'audit.submitted',
    table_name: 'audits',
    record_id: audit.id,
    after_data: {
      score_percent: result.score_percent,
      passed: result.passed,
      critical_fail: result.critical_fail,
      pass_mark_used: result.pass_mark,
      fatal_errors_ticked: payload.fatals.length,
      parameters_failed: payload.results.filter((r) => !r.passed).length,
      special_check_campaigns: payload.campaigns?.length ?? 0,
    },
  }])

  revalidatePath(`/audits/${audit.id}`)
  if (audit.crm_lead_id) revalidatePath(`/audits/leads/${audit.crm_lead_id}`)
  return { ok: true, result }
}
