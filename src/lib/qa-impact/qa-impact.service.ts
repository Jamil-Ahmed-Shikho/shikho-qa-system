// ============================================================
// SHIKHO QA SYSTEM — QA Manager dashboard, Stage 4: coaching impact
// (before vs. after) and revenue growth by channel (§11). Server-only.
// Both functions do their own role check — super_admin/qa_manager (Team
// View, always) or qa_auditor (My View or Team View) — see schema_055.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingQaImpactSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /qa_coaching_impact|qa_revenue_growth_by_channel/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export type CoachingOutcome = 'improved' | 'declined' | 'same' | 'pending'

export interface CoachingImpactRow {
  briefingId: string
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  coachingDate: string
  beforeScore: number
  afterScore: number | null
  scoreDelta: number | null
  outcome: CoachingOutcome
}

export async function loadCoachingImpact(from: Date, to: Date, view: QaRankingView = 'team'): Promise<CoachingImpactRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_coaching_impact', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load coaching impact: ${error.message}`)
  return (data ?? []).map((r: {
    briefing_id: string; agent_id: string; agent_name: string; team_name: string | null; site_name: string | null
    coaching_date: string; before_score: number; after_score: number | null; score_delta: number | null; outcome: CoachingOutcome
  }) => ({
    briefingId: r.briefing_id, agentId: r.agent_id, agentName: r.agent_name, teamName: r.team_name, siteName: r.site_name,
    coachingDate: r.coaching_date, beforeScore: r.before_score, afterScore: r.after_score, scoreDelta: r.score_delta, outcome: r.outcome,
  }))
}

export interface RevenueGrowthRow {
  channel: string
  agentsCount: number
  revenueNowUsd: number
  revenuePriorUsd: number
  growthPct: number | null
}

export async function loadRevenueGrowthByChannel(from: Date, to: Date, view: QaRankingView = 'team'): Promise<RevenueGrowthRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('qa_revenue_growth_by_channel', { p_from: from.toISOString(), p_to: to.toISOString(), p_view: view })
  if (error) throw new Error(`Could not load revenue growth by channel: ${error.message}`)
  return (data ?? []).map((r: { channel: string; agents_count: number; revenue_now_usd: number; revenue_prior_usd: number; growth_pct: number | null }) => ({
    channel: r.channel, agentsCount: r.agents_count, revenueNowUsd: r.revenue_now_usd, revenuePriorUsd: r.revenue_prior_usd, growthPct: r.growth_pct,
  }))
}
