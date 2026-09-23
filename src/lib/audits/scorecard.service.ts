// ============================================================
// SHIKHO QA SYSTEM — load a scorecard (§4)
// Server-only. Runs as the signed-in user, so row-level security decides
// what they can see (a Team Lead only their team's, etc.).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { getRubricTree } from '@/lib/rubrics/rubrics.service'
import { listCampaignTrees } from '@/lib/campaigns/campaigns.service'
import { buildSpecialCampaigns, type SpecialAnswers, type SpecialCampaign } from '@/lib/campaigns/special'
import type { MarksPayload, ScorecardRubric } from './scoring'

export interface LoadedScorecard {
  rubric: ScorecardRubric
  /** What has been saved so far (a saved draft, or the submitted marks). */
  saved: MarksPayload
  /** The pass mark in force now (rubric's own, else org-wide). For a submitted audit, use audits.pass_mark_used instead. */
  passMark: number | null
  /**
   * Special Check campaigns for this audit. On a draft: everything the auditor can pick (active, ready, applies to
   * the agent's team) plus anything already attached. On a submitted audit: only what was attached and answered.
   */
  special: SpecialCampaign[]
}

export interface ScorecardContext {
  /** The audited agent's team, for Special Check team scoping. */
  agentTeam: string | null
  /** true while the audit is still an editable draft. */
  isDraft: boolean
}

/**
 * The audit's rubric is the one locked when the audit was started
 * (audits.rubric_id, §4) — NOT whatever the team is mapped to today — so a
 * later rubric change never alters an audit in progress or already done.
 *
 * `overallFeedback` is the audits.overall_feedback of the row the page has
 * already loaded — passed in rather than fetched again, so the screen can't
 * show a status and score from one read and a missing summary from another.
 */
export async function loadScorecard(
  auditId: string,
  rubricId: string,
  overallFeedback: string | null,
  context: ScorecardContext,
): Promise<LoadedScorecard | null> {
  const tree = await getRubricTree(rubricId)
  if (!tree) return null

  const supabase = await getSupabaseServer()

  const rubric: ScorecardRubric = {
    id: tree.id,
    name: tree.name,
    version: tree.version,
    totalPoints: Number(tree.total_points),
    categories: tree.rubric_categories.map((c) => ({
      id: c.id,
      name: c.name,
      parameters: c.rubric_parameters.map((p) => ({
        id: p.id,
        name: p.name,
        points: Number(p.points),
        errorAttributes: p.rubric_error_attributes.map((a) => ({ id: a.id, description: a.description })),
      })),
    })),
    fatals: tree.fatal_parameters.map((f) => ({ id: f.id, description: f.description, severity: f.severity })),
  }

  const [resultsRes, fatalsRes, thresholdsRes, linksRes, answersRes, campaignTrees] = await Promise.all([
    supabase
      .from('audit_parameter_results')
      .select('parameter_id, passed, feedback, audit_error_ticks(error_attribute_id, root_cause_category)')
      .eq('audit_id', auditId),
    supabase.from('audit_fatal_results').select('fatal_parameter_id, feedback').eq('audit_id', auditId),
    supabase
      .from('status_thresholds')
      .select('rubric_id, yellow_min')
      .is('effective_to', null)
      .or(`rubric_id.eq.${rubricId},rubric_id.is.null`),
    supabase.from('audit_campaigns').select('campaign_id').eq('audit_id', auditId),
    supabase.from('audit_campaign_answers').select('campaign_id, check_type_id, value_id').eq('audit_id', auditId),
    listCampaignTrees(),
  ])

  // A failed read must NOT look like an empty scorecard: the auditor could then
  // "save" that emptiness over a real draft. Fail loudly instead.
  for (const [what, res] of [['scorecard results', resultsRes], ['fatal errors', fatalsRes], ['pass mark', thresholdsRes], ['Special Check links', linksRes], ['Special Check answers', answersRes]] as const) {
    if (res.error) {
      console.error(`loadScorecard: reading ${what} for audit ${auditId} failed:`, res.error.code, res.error.message)
      throw new Error(`Could not load this audit's ${what}. Please reload the page.`)
    }
  }
  const results = resultsRes.data
  const fatalRows = fatalsRes.data
  const thresholds = thresholdsRes.data

  // Special Checks: what the audit already has attached and answered (a campaign is attached even with no answers yet).
  const savedAnswers: SpecialAnswers = {}
  for (const l of linksRes.data ?? []) savedAnswers[l.campaign_id] = {}
  for (const a of answersRes.data ?? []) (savedAnswers[a.campaign_id] ??= {})[a.check_type_id] = a.value_id
  const special = buildSpecialCampaigns(campaignTrees, savedAnswers, { team: context.agentTeam, editable: context.isDraft })

  const saved: MarksPayload = {
    results: [], ticks: [], fatals: [], overall_feedback: overallFeedback ?? '',
    campaigns: Object.entries(savedAnswers).map(([campaign_id, byCheck]) => ({
      campaign_id,
      answers: Object.entries(byCheck).map(([check_type_id, value_id]) => ({ check_type_id, value_id })),
    })),
  }
  for (const r of results ?? []) {
    saved.results.push({ parameter_id: r.parameter_id, passed: r.passed, feedback: r.feedback ?? null })
    for (const t of (r.audit_error_ticks as { error_attribute_id: string; root_cause_category: MarksPayload['ticks'][number]['root_cause_category'] }[] | null) ?? []) {
      saved.ticks.push({ parameter_id: r.parameter_id, error_attribute_id: t.error_attribute_id, root_cause_category: t.root_cause_category })
    }
  }
  saved.fatals = (fatalRows ?? []).map((f) => ({ fatal_parameter_id: f.fatal_parameter_id, feedback: f.feedback ?? null }))

  // This rubric's own mark wins over the org-wide default.
  const own = thresholds?.find((t) => t.rubric_id === rubricId)
  const org = thresholds?.find((t) => t.rubric_id === null)
  const mark = own ?? org
  return { rubric, saved, passMark: mark ? Number(mark.yellow_min) : null, special }
}
