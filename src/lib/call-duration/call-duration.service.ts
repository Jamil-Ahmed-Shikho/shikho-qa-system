// ============================================================
// SHIKHO QA SYSTEM — Call Duration Audit Coverage report (Jamil, 2026-11-10).
// Server-only. qa_call_duration_distribution() (schema_114) does its own role check —
// super_admin/qa_manager (Team View, always) or qa_auditor (My View or Team View),
// same shape as every other report in this system (§2).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import type { TeamName } from '@/types/database.types'

export function isMissingCallDurationSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_call_duration_distribution/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface CallDurationRow {
  auditorId: string
  auditorName: string
  slab: string
  slabOrder: number
  callsDone: number
}

export async function loadCallDurationDistribution(
  from: Date, to: Date, view: QaRankingView = 'team', teamName: TeamName | null = null
): Promise<CallDurationRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_call_duration_distribution', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_view: view, p_team_name: teamName,
  })
  if (error) throw new Error(`Could not load the call duration distribution: ${error.message}`)
  return (data ?? []).map((r: { auditor_id: string; auditor_name: string; slab: string; slab_order: number; calls_done: number }) => ({
    auditorId: r.auditor_id, auditorName: r.auditor_name, slab: r.slab, slabOrder: r.slab_order, callsDone: r.calls_done,
  }))
}
