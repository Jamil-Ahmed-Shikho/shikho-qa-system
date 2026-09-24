// ============================================================
// Which rubric an audit uses: the agent's team's NEWEST ACTIVE rubric.
// Pure — startAudit fetches every team's active mappings in one query
// (a handful of rows, in parallel with the owner lookup) and picks here,
// instead of running an ORDER BY … LIMIT 1 query per audit after the fact.
// ============================================================

export interface MappingRow {
  team_name: string
  rubric_id: string
  /** PostgREST returns a to-one embed as an object, occasionally as a one-element array. */
  rubrics: { created_at: string } | { created_at: string }[] | null
}

/** team_name -> the rubric_id whose rubric was created most recently. Inactive rubrics must already be filtered out. */
export function pickNewestMappings(rows: MappingRow[]): Map<string, { rubric_id: string }> {
  const newest = new Map<string, { rubric_id: string; created: string }>()
  for (const row of rows) {
    const r = Array.isArray(row.rubrics) ? row.rubrics[0] : row.rubrics
    const created = r?.created_at ?? ''
    const cur = newest.get(row.team_name)
    if (!cur || created > cur.created) newest.set(row.team_name, { rubric_id: row.rubric_id, created })
  }
  return new Map([...newest].map(([team, v]) => [team, { rubric_id: v.rubric_id }]))
}
