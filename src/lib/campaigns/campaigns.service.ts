// ============================================================
// SHIKHO QA SYSTEM — Special Checks / Campaigns: reads (Part B)
// Server-only. Runs as the signed-in user, so row-level security decides who
// can see what (definitions: QA roles, Team Leads, Managers; agents nothing).
//
// A failed read throws. It must never look like "no campaigns" — an admin
// could then believe a campaign is gone and recreate it.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { Campaign, CampaignCheckType, CampaignCheckValue } from '@/types/database.types'
import { bySortOrder, type CampaignTree, type CampaignTreeCheck } from './rules'

export interface Usage {
  submitted: number
  draft: number
}
const NONE: Usage = { submitted: 0, draft: 0 }

export interface CampaignUsage {
  /** Audits linked to the campaign itself. */
  campaign: Usage
  checks: Record<string, Usage>
  options: Record<string, Usage>
}

type RawCheck = CampaignCheckType & { campaign_check_values: CampaignCheckValue[] | null }
type RawCampaign = Campaign & { campaign_check_types: RawCheck[] | null }

function toTree(raw: RawCampaign): CampaignTree {
  const { campaign_check_types, ...campaign } = raw
  const checkTypes: CampaignTreeCheck[] = (campaign_check_types ?? [])
    .map(({ campaign_check_values, ...check }) => ({ ...check, values: [...(campaign_check_values ?? [])].sort(bySortOrder) }))
    .sort(bySortOrder)
  return { ...campaign, checkTypes }
}

// The foreign keys are named explicitly: audit_campaign_answers also links checks
// to options (a second, many-to-many path between them), and PostgREST refuses to
// guess between two possible relationships.
const TREE_SELECT =
  '*, campaign_check_types!campaign_check_types_campaign_id_fkey(*, campaign_check_values!campaign_check_values_check_type_id_fkey(*))'

function fail(what: string, error: { code?: string; message: string }): never {
  console.error(`campaigns.service: reading ${what} failed:`, error.code, error.message)
  throw new Error(`Could not load ${what}. Please reload the page.`)
}

/** Every campaign (active and archived) with its checks and options — the definitions only. */
export async function listCampaignTrees(): Promise<CampaignTree[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaigns').select(TREE_SELECT).order('name', { ascending: true })
  if (error) fail('the Special Checks', error)
  return ((data ?? []) as unknown as RawCampaign[]).map(toTree)
}

export interface CampaignListItem {
  tree: CampaignTree
  usage: Usage
}

/** Every campaign (active and archived) with its checks and options, and how many audits used it. */
export async function listCampaigns(): Promise<CampaignListItem[]> {
  const supabase = await getSupabaseServer()
  const [trees, counts] = await Promise.all([listCampaignTrees(), supabase.rpc('campaign_audit_counts')])
  if (counts.error) fail('Special Check usage', counts.error)

  const usage = new Map<string, Usage>()
  for (const row of (counts.data ?? []) as { campaign_id: string; submitted_audits: number; draft_audits: number }[]) {
    usage.set(row.campaign_id, { submitted: row.submitted_audits, draft: row.draft_audits })
  }
  return trees.map((tree) => ({ tree, usage: usage.get(tree.id) ?? NONE }))
}

/** One campaign in full, plus how much of it has been used (which decides what may be renamed or deleted). */
export async function getCampaign(id: string): Promise<{ tree: CampaignTree; usage: CampaignUsage } | null> {
  const supabase = await getSupabaseServer()
  const [campaign, itemUsage, counts] = await Promise.all([
    supabase.from('campaigns').select(TREE_SELECT).eq('id', id).maybeSingle(),
    supabase.rpc('campaign_item_usage', { p_campaign_id: id }),
    supabase.rpc('campaign_audit_counts'),
  ])
  if (campaign.error) fail('the Special Check', campaign.error)
  if (itemUsage.error) fail('Special Check usage', itemUsage.error)
  if (counts.error) fail('Special Check usage', counts.error)
  if (!campaign.data) return null

  const usage: CampaignUsage = { campaign: NONE, checks: {}, options: {} }
  for (const row of (itemUsage.data ?? []) as { item_type: string; item_id: string; submitted_audits: number; draft_audits: number }[]) {
    const u = { submitted: row.submitted_audits, draft: row.draft_audits }
    if (row.item_type === 'check_type') usage.checks[row.item_id] = u
    else if (row.item_type === 'value') usage.options[row.item_id] = u
  }
  const mine = ((counts.data ?? []) as { campaign_id: string; submitted_audits: number; draft_audits: number }[]).find((c) => c.campaign_id === id)
  if (mine) usage.campaign = { submitted: mine.submitted_audits, draft: mine.draft_audits }

  return { tree: toTree(campaign.data as unknown as RawCampaign), usage }
}
