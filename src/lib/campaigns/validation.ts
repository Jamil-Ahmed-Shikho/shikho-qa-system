// ============================================================
// SHIKHO QA SYSTEM — Special Checks / Campaigns: input validation (Part B)
// Pure module. The database enforces the same rules (schema_014); this gives
// the admin a clear message before a round trip.
// ============================================================

import { TEAM_NAMES } from '@/types/database.types'
import { CAMPAIGN_LIMITS } from './rules'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const length = (s: string) => Array.from(s).length

/** One line of text: runs of whitespace (including line breaks) collapse to one space. */
export function cleanLine(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
}

/** Free text that may span lines: just trimmed. */
function cleanBlock(text: unknown): string {
  return typeof text === 'string' ? text.trim() : ''
}

export interface CampaignInput {
  name: string
  description: string
  allTeams: boolean
  teamNames: string[]
}

export interface CampaignValues {
  name: string
  description: string | null
  all_teams: boolean
  team_names: string[]
}

export function validateCampaignInput(input: CampaignInput): Result<CampaignValues> {
  const name = cleanLine(input?.name)
  if (!name) return { ok: false, error: 'Give the campaign a name.' }
  if (length(name) > CAMPAIGN_LIMITS.name) return { ok: false, error: `The name can be at most ${CAMPAIGN_LIMITS.name} characters.` }

  const description = cleanBlock(input?.description)
  if (length(description) > CAMPAIGN_LIMITS.description) return { ok: false, error: `The description can be at most ${CAMPAIGN_LIMITS.description} characters.` }

  const allTeams = input?.allTeams === true
  const known = new Set<string>(TEAM_NAMES)
  const requested = Array.isArray(input?.teamNames) ? input.teamNames : []
  if (!allTeams && requested.some((t) => !known.has(t))) return { ok: false, error: 'One of the selected teams isn\'t a known team.' }
  const teamNames = allTeams ? [] : TEAM_NAMES.filter((t) => requested.includes(t)) // de-duplicated, in the standard order
  if (!allTeams && teamNames.length === 0) return { ok: false, error: 'Choose "All teams" or select at least one team.' }

  return { ok: true, value: { name, description: description || null, all_teams: allTeams, team_names: teamNames } }
}

export interface CheckTypeInput {
  name: string
  description: string
}

export function validateCheckTypeInput(input: CheckTypeInput): Result<{ name: string; description: string | null }> {
  const name = cleanLine(input?.name)
  if (!name) return { ok: false, error: 'Write what should be checked (e.g. "Mentioned the new course launch?").' }
  if (length(name) > CAMPAIGN_LIMITS.checkName) return { ok: false, error: `The check can be at most ${CAMPAIGN_LIMITS.checkName} characters.` }
  const description = cleanBlock(input?.description)
  if (length(description) > CAMPAIGN_LIMITS.checkDescription) return { ok: false, error: `The note can be at most ${CAMPAIGN_LIMITS.checkDescription} characters.` }
  return { ok: true, value: { name, description: description || null } }
}

export function validateOptionLabel(label: string): Result<string> {
  const value = cleanLine(label)
  if (!value) return { ok: false, error: 'Write the option text.' }
  if (length(value) > CAMPAIGN_LIMITS.option) return { ok: false, error: `An option can be at most ${CAMPAIGN_LIMITS.option} characters.` }
  return { ok: true, value }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
export const isUuidList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 200 && v.every(isUuid)
