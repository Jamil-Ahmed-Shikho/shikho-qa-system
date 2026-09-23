// ============================================================
// SHIKHO QA SYSTEM — Rubric Engine (§3)
// Read-only data access — server components only
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { Rubric, RubricWithTree } from '@/types/database.types'

export async function listRubrics(): Promise<
  (Rubric & { team_rubric_mapping: { team_name: string }[] })[]
> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('rubrics')
    .select('*, team_rubric_mapping(team_name)')
    .order('name', { ascending: true })
    .order('version', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getRubricTree(id: string): Promise<RubricWithTree | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('rubrics')
    .select(
      `*,
      team_rubric_mapping(team_name),
      fatal_parameters(*),
      rubric_categories(
        *,
        rubric_parameters(
          *,
          rubric_error_attributes(*)
        )
      )`
    )
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // no rows
    throw new Error(error.message)
  }

  // Sort nested collections by sort_order — Postgres/PostgREST doesn't
  // guarantee nested-select ordering without per-relation .order(), which
  // the query-string embed syntax above doesn't support cleanly, so sort
  // client-side here instead.
  const tree = data as unknown as RubricWithTree
  tree.rubric_categories.sort((a, b) => a.sort_order - b.sort_order)
  for (const cat of tree.rubric_categories) {
    cat.rubric_parameters.sort((a, b) => a.sort_order - b.sort_order)
    for (const param of cat.rubric_parameters) {
      param.rubric_error_attributes.sort((a, b) => a.sort_order - b.sort_order)
    }
  }
  tree.fatal_parameters.sort((a, b) => a.sort_order - b.sort_order)

  return tree
}
