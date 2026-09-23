// ============================================================
// SHIKHO QA SYSTEM — Special Checks / Campaigns: rules (Part B)
// Pure module — safe for client and server.
//
// A campaign is an ad-hoc management check layered on an audit. It never
// affects scoring. Its definition is a tree:
//     campaign -> check types (the things to check) -> options (a CLOSED list)
// ============================================================

import type { Campaign, CampaignCheckType, CampaignCheckValue } from '@/types/database.types'

/**
 * Active options per check: 2–10. Two is the practical floor — a dropdown with
 * one choice means nothing — and ten is a sanity ceiling.
 *
 * The database enforces the MAXIMUM (a trigger). The minimum is a READINESS
 * rule: while an admin is still building a check it can have any number of
 * options, but a campaign is only offered on new audits once every active
 * check has a usable list. Archiving or deleting an option that would break
 * that is allowed but warned about (`optionRemovalWarning`), never blocked.
 */
export const OPTION_LIMITS = { min: 2, max: 10 } as const

/** Text limits — mirror the table constraints in schema_014. */
export const CAMPAIGN_LIMITS = { name: 100, description: 500, checkName: 200, checkDescription: 300, option: 100 } as const

export interface CampaignTreeCheck extends CampaignCheckType {
  values: CampaignCheckValue[]
}

export interface CampaignTree extends Campaign {
  checkTypes: CampaignTreeCheck[]
}

export const bySortOrder = <T extends { sort_order: number; created_at: string }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)

export const activeOptions = (check: CampaignTreeCheck) => check.values.filter((v) => !v.is_archived)
export const activeChecks = (campaign: CampaignTree) => campaign.checkTypes.filter((c) => !c.is_archived)

export interface Readiness {
  /** Offered on new audits: not archived, has ≥1 active check, every active check has 2–10 active options. */
  ready: boolean
  /** What's still missing, in words an admin can act on. Empty when ready (or archived). */
  problems: string[]
}

export function campaignReadiness(campaign: CampaignTree): Readiness {
  if (campaign.is_archived) return { ready: false, problems: [] }
  const problems: string[] = []
  const checks = activeChecks(campaign)
  if (checks.length === 0) problems.push('Add at least one check.')
  for (const check of checks) {
    const n = activeOptions(check).length
    if (n < OPTION_LIMITS.min) {
      problems.push(`"${check.name}" has ${n} active option${n === 1 ? '' : 's'} — it needs at least ${OPTION_LIMITS.min} (up to ${OPTION_LIMITS.max}).`)
    } else if (n > OPTION_LIMITS.max) {
      problems.push(`"${check.name}" has ${n} active options — the most it can have is ${OPTION_LIMITS.max}.`)
    }
  }
  return { ready: problems.length === 0, problems }
}

/** Does this campaign apply to an agent on `teamName`? (`all_teams`, or the team is listed.) */
export function campaignAppliesToTeam(campaign: Pick<Campaign, 'all_teams' | 'team_names'>, teamName: string | null): boolean {
  if (campaign.all_teams) return true
  return teamName !== null && campaign.team_names.includes(teamName)
}

export function scopeLabel(campaign: Pick<Campaign, 'all_teams' | 'team_names'>): string {
  return campaign.all_teams ? 'All teams' : campaign.team_names.join(', ')
}

/** Move `id` one step up/down within `ids`, hopping over anything `isHidden` (e.g. archived items that aren't shown). */
export function moveWithin(ids: string[], id: string, direction: -1 | 1, isHidden: (id: string) => boolean = () => false): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0) return null
  let to = from + direction
  while (to >= 0 && to < ids.length && isHidden(ids[to])) to += direction
  if (to < 0 || to >= ids.length) return null
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

// ── warn before breaking a working campaign (never block) ────

/**
 * If archiving/deleting this option would leave an ACTIVE check in an ACTIVE
 * campaign with fewer than the minimum active options — so the campaign stops
 * being offered on new audits — returns the warning to confirm; otherwise null.
 * It only speaks when the action CROSSES the floor: removing an already-archived
 * option, or one from a check that is already short, changes nothing new.
 */
export function optionRemovalWarning(
  campaign: CampaignTree,
  checkId: string,
  optionId: string,
  verb: 'Archiving' | 'Deleting',
): string | null {
  const check = campaign.checkTypes.find((c) => c.id === checkId)
  const option = check?.values.find((v) => v.id === optionId)
  if (!check || !option || campaign.is_archived || check.is_archived || option.is_archived) return null

  const before = activeOptions(check).length
  const after = before - 1
  if (before < OPTION_LIMITS.min || after >= OPTION_LIMITS.min) return null
  return (
    `${verb} "${option.label}" leaves "${check.name}" with only ${after} active option${after === 1 ? '' : 's'}. ` +
    `A check needs at least ${OPTION_LIMITS.min} active options to be usable, so "${campaign.name}" won't be offered on new audits until you add more.`
  )
}

/** The same warning for archiving/deleting a whole check, when it is the campaign's last active one. */
export function checkRemovalWarning(campaign: CampaignTree, checkId: string, verb: 'Archiving' | 'Deleting'): string | null {
  const check = campaign.checkTypes.find((c) => c.id === checkId)
  if (!check || campaign.is_archived || check.is_archived) return null
  if (activeChecks(campaign).length !== 1) return null
  return (
    `"${check.name}" is the last active check in "${campaign.name}". ` +
    `${verb} it leaves the campaign with no active checks, so it won't be offered on new audits until you add one.`
  )
}
