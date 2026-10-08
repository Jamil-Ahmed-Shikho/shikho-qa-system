'use server'
// ============================================================
// SHIKHO QA SYSTEM — save / submit a Sample Check (Phase 3, §4/§5)
//
// A SEPARATE action pair from scoring-actions.ts, calling the SEPARATE
// submit_sample_check() RPC (schema_073) — never write_audit_results(),
// whose rubric-parameter validation simply doesn't apply here. Same
// "{ok,error} objects, not thrown errors" discipline (CLAUDE.md §14), and
// the same "session client checks who/what, admin client runs the write"
// split scoring-actions.ts uses, since submit_sample_check() — like
// write_audit_results() — is granted to service_role only, not authenticated.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { normalizeFeedback, FEEDBACK_LIMITS, type SpecialPayload } from './scoring'
import type { SampleCheckPayload } from './sample-check'

type Failure = { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

function parseInput(input: unknown): { ok: true; payload: SampleCheckPayload } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  if (!input || typeof input !== 'object') return bad('Malformed Special Check.')
  const { overall_feedback, campaigns } = input as Record<string, unknown>

  if (overall_feedback !== undefined && overall_feedback !== null && typeof overall_feedback !== 'string') return bad('Malformed overall feedback.')
  const overall = normalizeFeedback(overall_feedback as string | null | undefined)
  if (Array.from(overall).length > FEEDBACK_LIMITS.overall) return bad(`Overall feedback is too long (the limit is ${FEEDBACK_LIMITS.overall} characters).`)

  if (!Array.isArray(campaigns) || campaigns.length > 50) return bad('Malformed Special Check data.')
  const parsed: SpecialPayload[] = []
  for (const c of campaigns) {
    const x = c as Record<string, unknown>
    if (!x || !isUuid(x.campaign_id) || !Array.isArray(x.answers) || x.answers.length > 200) return bad('Malformed Special Check data.')
    const answers: SpecialPayload['answers'] = []
    for (const a of x.answers) {
      const y = a as Record<string, unknown>
      if (!y || !isUuid(y.check_type_id) || !isUuid(y.value_id)) return bad('Malformed Special Check answer.')
      answers.push({ check_type_id: y.check_type_id, value_id: y.value_id })
    }
    parsed.push({ campaign_id: x.campaign_id, answers })
  }
  return { ok: true, payload: { overall_feedback: overall, campaigns: parsed } }
}

type Prepared =
  | { error: string }
  | { actorId: string; auditId: string; crmLeadId: string | null; payload: SampleCheckPayload }

async function prepare(auditId: string, rawPayload: unknown): Promise<Prepared> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(user.role)) {
    return { error: 'Only QA roles can log a Special Check.' }
  }

  const parsed = parseInput(rawPayload)
  if (!parsed.ok) return { error: parsed.error }

  const supabase = await getSupabaseServer()
  const { data: audit } = await supabase
    .from('audits')
    .select('id, auditor_id, status, check_mode, crm_lead_id')
    .eq('id', auditId)
    .maybeSingle()
  if (!audit) return { error: 'Special Check not found.' }
  if (audit.check_mode !== 'sample_check') return { error: 'This is a real audit — use the scorecard instead.' }
  if (audit.auditor_id !== user.profile.id) return { error: 'Only the person who started this Special Check can log it.' }
  if (audit.status !== 'draft') return { error: 'This Special Check has already been submitted and can no longer be changed.' }

  return { actorId: user.profile.id, auditId: audit.id, crmLeadId: audit.crm_lead_id, payload: parsed.payload }
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === 'P0001') return error.message
  console.error('submit_sample_check failed:', error.code, error.message)
  return 'Something went wrong saving the Special Check. Please try again.'
}

async function write(auditId: string, actorId: string, finalize: boolean, p: SampleCheckPayload) {
  return getSupabaseAdmin().rpc('submit_sample_check', {
    p_audit_id: auditId,
    p_actor: actorId,
    p_finalize: finalize,
    p_campaigns: p.campaigns,
    p_overall_feedback: p.overall_feedback,
  })
}

export async function saveSampleCheckDraft(auditId: string, rawPayload: unknown): Promise<{ ok: true } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }

  const { error } = await write(ctx.auditId, ctx.actorId, false, ctx.payload)
  if (error) return { ok: false, error: friendly(error) }

  revalidatePath(`/audits/${ctx.auditId}`)
  return { ok: true }
}

export async function submitSampleCheck(auditId: string, rawPayload: unknown): Promise<{ ok: true } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }

  const { error } = await write(ctx.auditId, ctx.actorId, true, ctx.payload)
  if (error) return { ok: false, error: friendly(error) }

  revalidatePath(`/audits/${ctx.auditId}`)
  if (ctx.crmLeadId) revalidatePath(`/audits/leads/${ctx.crmLeadId}`)
  return { ok: true }
}
