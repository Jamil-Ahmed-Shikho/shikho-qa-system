// ============================================================
// SHIKHO QA SYSTEM — load a Sample Check (Phase 3, §4/§5)
// Server-only. Runs as the signed-in user, so row-level security decides
// what they can see — same visibility as a normal audit (QA all, Team
// Lead own team, Manager own chain, agent never). Deliberately does NOT
// load a rubric tree at all (unlike loadScorecard) — a Sample Check is
// never scored, so there is nothing rubric-shaped to fetch.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { listCampaignTrees } from '@/lib/campaigns/campaigns.service'
import { buildSpecialCampaigns, type SpecialAnswers, type SpecialCampaign } from '@/lib/campaigns/special'
import type { SampleCheckPayload } from './sample-check'

export interface LoadedSampleCheck {
  /** Same shape loadScorecard() returns for "special" — everything pickable (draft) or what was attached (submitted). */
  special: SpecialCampaign[]
  saved: SampleCheckPayload
}

export interface SampleCheckContext {
  agentTeam: string | null
  isDraft: boolean
}

export async function loadSampleCheck(auditId: string, overallFeedback: string | null, context: SampleCheckContext): Promise<LoadedSampleCheck> {
  const supabase = await getSupabaseServer()

  const [linksRes, answersRes, campaignTrees] = await Promise.all([
    supabase.from('audit_campaigns').select('campaign_id').eq('audit_id', auditId),
    supabase.from('audit_campaign_answers').select('campaign_id, check_type_id, value_id').eq('audit_id', auditId),
    listCampaignTrees(),
  ])

  // A failed read must not look like an empty Sample Check (§14 — the same discipline loadScorecard() uses).
  for (const [what, res] of [['Special Check links', linksRes], ['Special Check answers', answersRes]] as const) {
    if (res.error) {
      console.error(`loadSampleCheck: reading ${what} for audit ${auditId} failed:`, res.error.code, res.error.message)
      throw new Error(`Could not load this Special Check's ${what}. Please reload the page.`)
    }
  }

  const savedAnswers: SpecialAnswers = {}
  for (const l of linksRes.data ?? []) savedAnswers[l.campaign_id] = {}
  for (const a of answersRes.data ?? []) (savedAnswers[a.campaign_id] ??= {})[a.check_type_id] = a.value_id
  const special = buildSpecialCampaigns(campaignTrees, savedAnswers, { team: context.agentTeam, editable: context.isDraft })

  const saved: SampleCheckPayload = {
    overall_feedback: overallFeedback ?? '',
    campaigns: Object.entries(savedAnswers).map(([campaign_id, byCheck]) => ({
      campaign_id,
      answers: Object.entries(byCheck).map(([check_type_id, value_id]) => ({ check_type_id, value_id })),
    })),
  }

  return { special, saved }
}
