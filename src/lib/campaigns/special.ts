// ============================================================
// SHIKHO QA SYSTEM — Special Checks on an audit (Part B2)
// Pure module — safe for client and server.
//
// Turns the campaign definitions plus what an audit has already saved into the
// view the scorecard renders: which campaigns can be picked, which checks each
// needs answered, and which options are on offer. The same rules are enforced
// by write_audit_results() (schema_016); this is the UI's mirror of them.
// ============================================================

import { campaignAppliesToTeam, campaignReadiness, type CampaignTree } from './rules'

export interface SpecialOption {
  id: string
  label: string
  /** Archived after it was chosen: shown (so the audit still reads correctly) but not offered to others. */
  archived: boolean
}

export interface SpecialCheck {
  id: string
  name: string
  description: string | null
  /** An active check must be answered to submit. An archived check that already has an answer is shown, not required. */
  required: boolean
  archived: boolean
  options: SpecialOption[]
}

export interface SpecialCampaign {
  id: string
  name: string
  description: string | null
  /** Archived after being attached: the audit can still be finished. */
  archived: boolean
  checks: SpecialCheck[]
}

/** campaign id -> (check id -> chosen option id). A campaign is ATTACHED to the audit when it is a key, even with no answers yet. */
export type SpecialAnswers = Record<string, Record<string, string>>

export interface BuildOptions {
  /** The agent's team, for team scoping. */
  team: string | null
  /**
   * true  = an editable draft: also offer campaigns that are active, ready and apply to the team;
   * false = a read-only view: only what is attached, and only the checks that were answered.
   */
  editable: boolean
}

export function buildSpecialCampaigns(trees: CampaignTree[], saved: SpecialAnswers, options: BuildOptions): SpecialCampaign[] {
  const out: SpecialCampaign[] = []
  for (const tree of trees) {
    const attached = tree.id in saved
    const offered = options.editable && !tree.is_archived && campaignReadiness(tree).ready && campaignAppliesToTeam(tree, options.team)
    if (!attached && !offered) continue

    const chosenFor = saved[tree.id] ?? {}
    const checks: SpecialCheck[] = []
    for (const check of tree.checkTypes) {
      const chosen = chosenFor[check.id]
      // Editable: every active check (to be answered) plus any archived one that already holds an answer.
      // Read-only: only the checks that were actually answered.
      const show = options.editable ? !check.is_archived || !!chosen : !!chosen
      if (!show) continue
      checks.push({
        id: check.id,
        name: check.name,
        description: check.description,
        required: options.editable && !check.is_archived,
        archived: check.is_archived,
        options: check.values
          .filter((v) => !v.is_archived || v.id === chosen)
          .map((v) => ({ id: v.id, label: v.label, archived: v.is_archived })),
      })
    }
    out.push({ id: tree.id, name: tree.name, description: tree.description, archived: tree.is_archived, checks })
  }
  return out
}

/** The label of the option chosen for a check, or null. */
export function chosenLabel(check: SpecialCheck, optionId: string | undefined): string | null {
  return check.options.find((o) => o.id === optionId)?.label ?? null
}
