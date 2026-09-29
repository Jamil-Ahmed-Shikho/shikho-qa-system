// ============================================================
// SHIKHO QA SYSTEM — CAPA / re-audit service (§4, Step 5)
// Server-only. Reads run as the signed-in user (row-level security decides).
// See supabase/schema_028_capa_disputes.sql for the rules: QA flags a failed
// audit as needing a re-audit; a later audit of the same agent is linked back
// to it (audits.re_audit_of); when that follow-up is submitted the original's
// capa_status becomes 'passed' or 'failed_again'.
// NO EMAIL, NO NOTIFICATION.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'

/** True when a failed read looks like "CAPA's own schema (capa_status/flag_reaudit/pending_reaudits) isn't applied yet" —
 * split out from the old shared isMissingDisputesSchema() when Disputes was removed entirely (schema_048). */
export function isMissingCapaSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /pending_reaudits|flag_reaudit|unflag_reaudit|capa_status/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export type CapaStatus = 'pending_reaudit' | 'passed' | 'failed_again'

export const CAPA_LABEL: Record<CapaStatus, string> = {
  pending_reaudit: 'Re-audit pending',
  passed: 'Re-audit passed',
  failed_again: 'Re-audit failed again',
}

export interface AuditRef {
  id: string
  status: string
  scorePercent: number | null
  passed: boolean | null
  submittedAt: string | null
  createdAt: string
}

export interface CapaInfo {
  /** This audit's own re-audit state (set when it failed and QA flagged it). */
  capaStatus: CapaStatus | null
  /** The failed audit this one follows up, if it is a re-audit. */
  followsUp: AuditRef | null
  /** The audit that follows THIS one up, if any. */
  followedBy: AuditRef | null
  /** Other audits of the same agent still waiting for a re-audit (only when this is a draft with no link yet). */
  linkable: AuditRef[]
}

function ref(r: Record<string, unknown>): AuditRef {
  return {
    id: r.id as string,
    status: r.status as string,
    scorePercent: r.score_percent === null || r.score_percent === undefined ? null : Number(r.score_percent),
    passed: (r.passed as boolean | null) ?? null,
    submittedAt: (r.submitted_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}
const REF_SELECT = 'id, status, score_percent, passed, submitted_at, created_at'

/** Throws on a failed read — an error must never look like "no re-audit". */
export async function loadCapaInfo(audit: { id: string; agent_id: string; status: string; re_audit_of: string | null; capa_status: string | null }): Promise<CapaInfo> {
  const supabase = await getSupabaseServer()
  const wantLinkable = audit.status === 'draft' && audit.re_audit_of === null

  const [orig, next, pending] = await Promise.all([
    audit.re_audit_of ? supabase.from('audits').select(REF_SELECT).eq('id', audit.re_audit_of).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('audits').select(REF_SELECT).eq('re_audit_of', audit.id).maybeSingle(),
    wantLinkable
      ? supabase.from('audits').select(REF_SELECT).eq('agent_id', audit.agent_id).eq('capa_status', 'pending_reaudit').is('re_audit_of', null).neq('id', audit.id).order('submitted_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const [what, res] of [['the audit this follows up', orig], ['its follow-up', next], ['pending re-audits', pending]] as const) {
    if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`)
  }

  // A pending audit that ALREADY has a follow-up draft can't take another (one follow-up per audit).
  const linkable: AuditRef[] = []
  for (const r of (pending.data ?? []) as unknown as Record<string, unknown>[]) {
    const { count, error } = await supabase.from('audits').select('*', { count: 'exact', head: true }).eq('re_audit_of', r.id as string)
    if (error) throw new Error(`Could not check the follow-up of a pending re-audit: ${error.message}`)
    if ((count ?? 0) === 0) linkable.push(ref(r))
  }

  return {
    capaStatus: (audit.capa_status as CapaStatus | null) ?? null,
    followsUp: orig.data ? ref(orig.data as unknown as Record<string, unknown>) : null,
    followedBy: next.data ? ref(next.data as unknown as Record<string, unknown>) : null,
    linkable,
  }
}

export interface PendingReaudit {
  auditId: string
  agentId: string
  agentName: string
  auditorName: string | null
  scorePercent: number | null
  criticalFail: boolean
  submittedAt: string | null
  followUpStarted: boolean
}

/** Everything currently waiting for a re-audit (each reader sees only what their own audit access allows). */
export async function listPendingReaudits(): Promise<PendingReaudit[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('pending_reaudits').select('audit_id, agent_id, auditor_id, score_percent, critical_fail, submitted_at, follow_up_started').order('submitted_at', { ascending: true }).limit(200)
  if (error) throw new Error(`Could not load pending re-audits: ${error.message}`)
  const rows = data ?? []
  const ids = [...new Set(rows.flatMap((r) => [r.agent_id as string, r.auditor_id as string]))]
  const names = new Map<string, string>()
  if (ids.length) {
    const u = await supabase.from('users').select('id, name').in('id', ids)
    if (u.error) throw new Error(`Could not load names: ${u.error.message}`)
    for (const x of u.data ?? []) names.set(x.id as string, x.name as string)
  }
  return rows.map((r) => ({
    auditId: r.audit_id as string,
    agentId: r.agent_id as string,
    agentName: names.get(r.agent_id as string) ?? 'Unknown agent',
    auditorName: names.get(r.auditor_id as string) ?? null,
    scorePercent: r.score_percent === null ? null : Number(r.score_percent),
    criticalFail: !!r.critical_fail,
    submittedAt: (r.submitted_at as string | null) ?? null,
    followUpStarted: !!r.follow_up_started,
  }))
}
