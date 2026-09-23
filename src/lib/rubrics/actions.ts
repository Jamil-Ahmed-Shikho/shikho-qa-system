'use server'
// ============================================================
// SHIKHO QA SYSTEM — Rubric Engine (§3)
// Server actions — all writes go through here
//
// RLS on rubrics/rubric_categories/rubric_parameters/rubric_error_
// attributes/fatal_parameters/team_rubric_mapping already restricts
// writes to super_admin/qa_manager (schema_003_rubrics.sql) — the
// requireRubricAdmin() check below is defense-in-depth for a clear
// error message, not the actual authorization boundary.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import type { FatalSeverity } from '@/types/database.types'

async function requireRubricAdmin() {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    throw new Error('Forbidden — only Super Admin / QA Manager can edit rubrics.')
  }
  return user
}

function revalidateRubric(id?: string) {
  revalidatePath('/admin/rubrics')
  if (id) revalidatePath(`/admin/rubrics/${id}`)
}

// ── Rubric ──────────────────────────────────────────────────

export async function createRubric(input: { name: string; total_points: number }) {
  const user = await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data, error } = await supabase
    .from('rubrics')
    .insert({
      name: input.name,
      total_points: input.total_points,
      version: 1,
      is_active: true,
      created_by: user.profile.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidateRubric()
  return data.id as string
}

export async function updateRubricMeta(
  id: string,
  input: { name: string; total_points: number }
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('rubrics')
    .update({ name: input.name, total_points: input.total_points })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(id)
}

export async function toggleRubricActive(id: string, is_active: boolean) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('rubrics').update({ is_active }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(id)
}

// Versioning (§1): rubrics are never edited in place once they're the
// live version in use — this clones the whole tree as version+1,
// activates it, and supersedes (deactivates) the old one so historical
// audits that reference the old rubric_id are unaffected.
export async function createRubricVersion(id: string) {
  const user = await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: source, error: sourceError } = await supabase
    .from('rubrics')
    .select(
      `*,
      team_rubric_mapping(team_name),
      fatal_parameters(*),
      rubric_categories(*, rubric_parameters(*, rubric_error_attributes(*)))`
    )
    .eq('id', id)
    .single()

  if (sourceError || !source) throw new Error(sourceError?.message ?? 'Rubric not found.')

  const { data: newRubric, error: insertError } = await supabase
    .from('rubrics')
    .insert({
      name: source.name,
      total_points: source.total_points,
      version: source.version + 1,
      is_active: true,
      created_by: user.profile.id,
    })
    .select('id')
    .single()

  if (insertError) throw new Error(insertError.message)
  const newRubricId = newRubric.id as string

  for (const cat of source.rubric_categories as any[]) {
    const { data: newCat, error: catError } = await supabase
      .from('rubric_categories')
      .insert({ rubric_id: newRubricId, name: cat.name, sort_order: cat.sort_order })
      .select('id')
      .single()
    if (catError) throw new Error(catError.message)

    for (const param of cat.rubric_parameters as any[]) {
      const { data: newParam, error: paramError } = await supabase
        .from('rubric_parameters')
        .insert({
          category_id: newCat.id,
          name: param.name,
          points: param.points,
          sort_order: param.sort_order,
        })
        .select('id')
        .single()
      if (paramError) throw new Error(paramError.message)

      const errorAttrs = (param.rubric_error_attributes as any[]).map((ea) => ({
        parameter_id: newParam.id,
        description: ea.description,
        sort_order: ea.sort_order,
      }))
      if (errorAttrs.length > 0) {
        const { error: eaError } = await supabase.from('rubric_error_attributes').insert(errorAttrs)
        if (eaError) throw new Error(eaError.message)
      }
    }
  }

  const fatals = (source.fatal_parameters as any[]).map((f) => ({
    rubric_id: newRubricId,
    description: f.description,
    severity: f.severity,
    sort_order: f.sort_order,
  }))
  if (fatals.length > 0) {
    const { error: fatalError } = await supabase.from('fatal_parameters').insert(fatals)
    if (fatalError) throw new Error(fatalError.message)
  }

  const mappings = (source.team_rubric_mapping as any[]).map((m) => ({
    rubric_id: newRubricId,
    team_name: m.team_name,
  }))
  if (mappings.length > 0) {
    const { error: mapError } = await supabase.from('team_rubric_mapping').insert(mappings)
    if (mapError) throw new Error(mapError.message)
  }

  const { error: deactivateError } = await supabase
    .from('rubrics')
    .update({ is_active: false })
    .eq('id', id)
  if (deactivateError) throw new Error(deactivateError.message)

  revalidateRubric(id)
  revalidateRubric(newRubricId)
  return newRubricId
}

// ── Team mapping ────────────────────────────────────────────
// A team should map to exactly one rubric at a time — selecting a team
// here removes any of its existing mappings (to any rubric) first.
export async function setTeamMapping(rubricId: string, teamNames: string[]) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: current, error: currentError } = await supabase
    .from('team_rubric_mapping')
    .select('team_name')
    .eq('rubric_id', rubricId)
  if (currentError) throw new Error(currentError.message)

  const currentTeams = new Set((current ?? []).map((r) => r.team_name))
  const nextTeams = new Set(teamNames)

  const toRemove = [...currentTeams].filter((t) => !nextTeams.has(t))
  const toAdd = [...nextTeams].filter((t) => !currentTeams.has(t))

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('team_rubric_mapping')
      .delete()
      .eq('rubric_id', rubricId)
      .in('team_name', toRemove)
    if (error) throw new Error(error.message)
  }

  if (toAdd.length > 0) {
    // Clear these teams from any other rubric first.
    const { error: clearError } = await supabase
      .from('team_rubric_mapping')
      .delete()
      .in('team_name', toAdd)
    if (clearError) throw new Error(clearError.message)

    const { error: insertError } = await supabase
      .from('team_rubric_mapping')
      .insert(toAdd.map((team_name) => ({ rubric_id: rubricId, team_name })))
    if (insertError) throw new Error(insertError.message)
  }

  revalidateRubric(rubricId)
}

// ── Categories ──────────────────────────────────────────────

export async function createCategory(rubricId: string, name: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: existing } = await supabase
    .from('rubric_categories')
    .select('sort_order')
    .eq('rubric_id', rubricId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

  const { error } = await supabase
    .from('rubric_categories')
    .insert({ rubric_id: rubricId, name, sort_order: nextOrder })
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function updateCategory(id: string, rubricId: string, name: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('rubric_categories').update({ name }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function deleteCategory(id: string, rubricId: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('rubric_categories').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function moveCategory(
  rubricId: string,
  categoryId: string,
  direction: 'up' | 'down'
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: categories, error } = await supabase
    .from('rubric_categories')
    .select('id, sort_order')
    .eq('rubric_id', rubricId)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)

  const index = (categories ?? []).findIndex((c) => c.id === categoryId)
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapIndex < 0 || swapIndex >= (categories ?? []).length) return

  const a = categories![index]
  const b = categories![swapIndex]

  const { error: e1 } = await supabase
    .from('rubric_categories')
    .update({ sort_order: b.sort_order })
    .eq('id', a.id)
  const { error: e2 } = await supabase
    .from('rubric_categories')
    .update({ sort_order: a.sort_order })
    .eq('id', b.id)
  if (e1) throw new Error(e1.message)
  if (e2) throw new Error(e2.message)

  revalidateRubric(rubricId)
}

// ── Parameters ──────────────────────────────────────────────

export async function createParameter(
  categoryId: string,
  rubricId: string,
  input: { name: string; points: number }
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: existing } = await supabase
    .from('rubric_parameters')
    .select('sort_order')
    .eq('category_id', categoryId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

  const { error } = await supabase.from('rubric_parameters').insert({
    category_id: categoryId,
    name: input.name,
    points: input.points,
    sort_order: nextOrder,
  })
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function updateParameter(
  id: string,
  rubricId: string,
  input: { name: string; points: number }
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('rubric_parameters')
    .update({ name: input.name, points: input.points })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function deleteParameter(id: string, rubricId: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('rubric_parameters').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

// ── Error attributes ────────────────────────────────────────

export async function createErrorAttribute(
  parameterId: string,
  rubricId: string,
  description: string
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: existing } = await supabase
    .from('rubric_error_attributes')
    .select('sort_order')
    .eq('parameter_id', parameterId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

  const { error } = await supabase
    .from('rubric_error_attributes')
    .insert({ parameter_id: parameterId, description, sort_order: nextOrder })
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function updateErrorAttribute(id: string, rubricId: string, description: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('rubric_error_attributes')
    .update({ description })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function deleteErrorAttribute(id: string, rubricId: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('rubric_error_attributes').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

// ── Fatal parameters ────────────────────────────────────────

export async function createFatalParameter(
  rubricId: string,
  input: { description: string; severity: FatalSeverity }
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()

  const { data: existing } = await supabase
    .from('fatal_parameters')
    .select('sort_order')
    .eq('rubric_id', rubricId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0

  const { error } = await supabase.from('fatal_parameters').insert({
    rubric_id: rubricId,
    description: input.description,
    severity: input.severity,
    sort_order: nextOrder,
  })
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function updateFatalParameter(
  id: string,
  rubricId: string,
  input: { description: string; severity: FatalSeverity }
) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('fatal_parameters')
    .update({ description: input.description, severity: input.severity })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}

export async function deleteFatalParameter(id: string, rubricId: string) {
  await requireRubricAdmin()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('fatal_parameters').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidateRubric(rubricId)
}
