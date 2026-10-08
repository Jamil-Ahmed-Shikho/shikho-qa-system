'use server'
// ============================================================
// SHIKHO QA SYSTEM — Special Checks / Campaigns: admin actions (Part B)
//
// Return { ok, error } objects, never throw (Next.js hides thrown messages
// in production builds — CLAUDE.md §14).
//
// Authorization is the database's: RLS lets only Super Admin / QA Manager
// write these tables, and triggers hold the rules that must never be broken
// (10 active options, frozen text once used, no deleting what's been used).
// requireAdmin() is defence in depth and gives a clear message.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import type { AuthUser } from '@/types/database.types'
import {
  isUuid,
  isUuidList,
  validateCampaignInput,
  validateCheckTypeInput,
  validateOptionLabel,
  type CampaignInput,
  type CheckTypeInput,
} from './validation'

type Fail = { ok: false; error: string }
type Ok = { ok: true }

async function requireAdmin(): Promise<{ actor: AuthUser } | Fail> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return { ok: false, error: 'Only Super Admin / QA Manager can manage special checks.' }
  }
  return { actor: user }
}

/** Database errors, in words an admin can act on. Our own rule messages (P0001) are already written that way. */
function friendly(error: { code?: string; message: string }): string {
  if (error.code === 'P0001') return error.message
  if (error.code === '23505') {
    if (error.message.includes('uq_campaigns_name')) return 'A Special Check with this name already exists.'
    if (error.message.includes('uq_campaign_check_types_name')) return 'This Special Check already has a check with that name.'
    if (error.message.includes('uq_campaign_check_values_label')) return 'This check already has an option with that text — it may be archived; un-archive it instead.'
    return 'That already exists.'
  }
  if (error.code === '23503') return 'This has been used by at least one audit, so it can\'t be deleted. Archive it instead.'
  if (error.code === '42501') return 'You don\'t have permission to do that.'
  if (error.code === '23514') return 'That value isn\'t allowed. Check the lengths and the team selection.'
  console.error('campaigns action failed:', error.code, error.message)
  return 'Something went wrong. Please try again.'
}

function refresh(campaignId?: string) {
  revalidatePath('/admin/campaigns')
  if (campaignId) revalidatePath(`/admin/campaigns/${campaignId}`)
}

async function log(actor: AuthUser, action: string, table: string, id: string, before?: unknown, after?: unknown) {
  await writeAuditLogs([{ actor_id: actor.profile.id, action, table_name: table, record_id: id, before_data: before, after_data: after }])
}

// ── campaigns ───────────────────────────────────────────────

export async function createCampaignAction(input: CampaignInput): Promise<{ ok: true; id: string } | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  const parsed = validateCampaignInput(input); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaigns').insert({ ...parsed.value, created_by: g.actor.profile.id }).select('*').single()
  if (error) return { ok: false, error: friendly(error) }

  await log(g.actor, 'campaign.created', 'campaigns', data.id, null, data)
  refresh()
  return { ok: true, id: data.id }
}

export async function updateCampaignAction(id: string, input: CampaignInput): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id)) return { ok: false, error: 'Unknown Special Check.' }
  const parsed = validateCampaignInput(input); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaigns').update(parsed.value).eq('id', id).select('*')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That Special Check no longer exists.' }

  await log(g.actor, 'campaign.updated', 'campaigns', id, before, data[0])
  refresh(id)
  return { ok: true }
}

export async function setCampaignArchivedAction(id: string, archived: boolean): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id)) return { ok: false, error: 'Unknown Special Check.' }

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaigns').update({ is_archived: archived }).eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That Special Check no longer exists.' }

  await log(g.actor, archived ? 'campaign.archived' : 'campaign.unarchived', 'campaigns', id, { is_archived: !archived }, { is_archived: archived })
  refresh(id)
  return { ok: true }
}

/** Only works for a campaign no audit has ever been attached to — the database refuses otherwise. */
export async function deleteCampaignAction(id: string): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id)) return { ok: false, error: 'Unknown Special Check.' }

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaigns').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That Special Check no longer exists.' }

  await log(g.actor, 'campaign.deleted', 'campaigns', id, before, null)
  refresh()
  return { ok: true }
}

// ── checks (the things to check) ────────────────────────────

export async function createCheckTypeAction(campaignId: string, input: CheckTypeInput): Promise<{ ok: true; id: string } | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(campaignId)) return { ok: false, error: 'Unknown Special Check.' }
  const parsed = validateCheckTypeInput(input); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaign_check_types').insert({ campaign_id: campaignId, ...parsed.value }).select('*').single()
  if (error) return { ok: false, error: friendly(error) }

  await log(g.actor, 'campaign_check.created', 'campaign_check_types', data.id, null, data)
  refresh(campaignId)
  return { ok: true, id: data.id }
}

export async function updateCheckTypeAction(id: string, campaignId: string, input: CheckTypeInput): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown check.' }
  const parsed = validateCheckTypeInput(input); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaign_check_types').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaign_check_types').update(parsed.value).eq('id', id).select('*')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That check no longer exists.' }

  await log(g.actor, 'campaign_check.updated', 'campaign_check_types', id, before, data[0])
  refresh(campaignId)
  return { ok: true }
}

export async function setCheckTypeArchivedAction(id: string, campaignId: string, archived: boolean): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown check.' }

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaign_check_types').update({ is_archived: archived }).eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That check no longer exists.' }

  await log(g.actor, archived ? 'campaign_check.archived' : 'campaign_check.unarchived', 'campaign_check_types', id, { is_archived: !archived }, { is_archived: archived })
  refresh(campaignId)
  return { ok: true }
}

export async function deleteCheckTypeAction(id: string, campaignId: string): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown check.' }

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaign_check_types').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaign_check_types').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That check no longer exists.' }

  await log(g.actor, 'campaign_check.deleted', 'campaign_check_types', id, before, null)
  refresh(campaignId)
  return { ok: true }
}

export async function reorderCheckTypesAction(campaignId: string, orderedIds: string[]): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(campaignId) || !isUuidList(orderedIds)) return { ok: false, error: 'Malformed request.' }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('reorder_campaign_check_types', { p_campaign_id: campaignId, p_ids: orderedIds })
  if (error) return { ok: false, error: friendly(error) }
  refresh(campaignId)
  return { ok: true }
}

// ── options (the closed answer list) ────────────────────────

export async function createOptionAction(checkTypeId: string, campaignId: string, label: string, isMistake: boolean = false): Promise<{ ok: true; id: string } | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(checkTypeId) || !isUuid(campaignId)) return { ok: false, error: 'Unknown check.' }
  const parsed = validateOptionLabel(label); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaign_check_values').insert({ check_type_id: checkTypeId, label: parsed.value, is_mistake: isMistake === true }).select('*').single()
  if (error) return { ok: false, error: friendly(error) }

  await log(g.actor, 'campaign_option.created', 'campaign_check_values', data.id, null, data)
  refresh(campaignId)
  return { ok: true, id: data.id }
}

/** Refused by the database once a submitted audit has used the option — archive it and add a new one instead. */
export async function updateOptionAction(id: string, campaignId: string, label: string): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown option.' }
  const parsed = validateOptionLabel(label); if (!parsed.ok) return parsed

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaign_check_values').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaign_check_values').update({ label: parsed.value }).eq('id', id).select('*')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That option no longer exists.' }

  await log(g.actor, 'campaign_option.updated', 'campaign_check_values', id, before, data[0])
  refresh(campaignId)
  return { ok: true }
}

/** Tag/untag an option as a mistake worth flagging in the Campaign Report's agent breakdown (schema_077).
 * A separate action from rename/archive — this is its own independent judgment call, not tied to editing
 * the option's text or its lifecycle state. */
export async function setOptionMistakeAction(id: string, campaignId: string, isMistake: boolean): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown option.' }

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaign_check_values').update({ is_mistake: isMistake === true }).eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That option no longer exists.' }

  await log(g.actor, isMistake ? 'campaign_option.marked_mistake' : 'campaign_option.unmarked_mistake', 'campaign_check_values', id, { is_mistake: !isMistake }, { is_mistake: isMistake })
  refresh(campaignId)
  return { ok: true }
}

export async function setOptionArchivedAction(id: string, campaignId: string, archived: boolean): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown option.' }

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('campaign_check_values').update({ is_archived: archived }).eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That option no longer exists.' }

  await log(g.actor, archived ? 'campaign_option.archived' : 'campaign_option.unarchived', 'campaign_check_values', id, { is_archived: !archived }, { is_archived: archived })
  refresh(campaignId)
  return { ok: true }
}

export async function deleteOptionAction(id: string, campaignId: string): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(id) || !isUuid(campaignId)) return { ok: false, error: 'Unknown option.' }

  const supabase = await getSupabaseServer()
  const { data: before } = await supabase.from('campaign_check_values').select('*').eq('id', id).maybeSingle()
  const { data, error } = await supabase.from('campaign_check_values').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: friendly(error) }
  if (!data?.length) return { ok: false, error: 'That option no longer exists.' }

  await log(g.actor, 'campaign_option.deleted', 'campaign_check_values', id, before, null)
  refresh(campaignId)
  return { ok: true }
}

export async function reorderOptionsAction(checkTypeId: string, campaignId: string, orderedIds: string[]): Promise<Ok | Fail> {
  const g = await requireAdmin(); if ('error' in g) return g
  if (!isUuid(checkTypeId) || !isUuid(campaignId) || !isUuidList(orderedIds)) return { ok: false, error: 'Malformed request.' }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('reorder_campaign_check_values', { p_check_type_id: checkTypeId, p_ids: orderedIds })
  if (error) return { ok: false, error: friendly(error) }
  refresh(campaignId)
  return { ok: true }
}
