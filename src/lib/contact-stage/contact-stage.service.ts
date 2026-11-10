// ============================================================
// SHIKHO QA SYSTEM — Contact Stage Audit Coverage report (Jamil, 2026-11-10).
// Server-only. qa_contact_stage_distribution() (schema_116) does its own role check —
// super_admin/qa_manager (Team View, always) or qa_auditor (My View or Team View),
// same shape as the Call Duration report.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import type { TeamName } from '@/types/database.types'

export function isMissingContactStageSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_contact_stage_distribution/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export interface ContactStageRow {
  auditorId: string
  auditorName: string
  stage: string
  callsDone: number
}

export async function loadContactStageDistribution(
  from: Date, to: Date, view: QaRankingView = 'team', teamName: TeamName | null = null
): Promise<ContactStageRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_contact_stage_distribution', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_view: view, p_team_name: teamName,
  })
  if (error) throw new Error(`Could not load the contact stage distribution: ${error.message}`)
  return (data ?? []).map((r: { auditor_id: string; auditor_name: string; stage: string; calls_done: number }) => ({
    auditorId: r.auditor_id, auditorName: r.auditor_name, stage: r.stage, callsDone: r.calls_done,
  }))
}
