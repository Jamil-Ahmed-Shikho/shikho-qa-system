// ============================================================
// SHIKHO QA SYSTEM — Portal usage report (Jamil, 2026-11-04). Server-only.
// portal_usage_report() (schema_109) does its own role/scope check — every
// role's visibility rules differ enough (Manager sees own chain's Team
// Leads + their whole chain's agents; Team Lead/QA Auditor see only
// themselves in Back Office; QA Auditor's Frontline My/Team View) that
// static RLS alone can't express it, same reasoning as every other
// My-View/Team-View report in this system (§2).
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

export function isMissingPortalUsageSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /portal_usage_report|user_activity_days/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export type PortalUsageScope = 'back_office' | 'frontline'
export type PortalUsageStatus = 'active' | 'low_usage' | 'inactive' | 'never'

export interface PortalUsageRow {
  userId: string
  name: string
  role: string
  teamName: string | null
  siteName: string | null
  /** Frontline rows only — null for Back Office. */
  teamLeaderName: string | null
  /** Frontline rows only — null for Back Office. */
  qualityAuditorName: string | null
  lastActiveDate: string | null
  daysSinceActive: number | null
  activeDays7: number
  activeDays30: number
  status: PortalUsageStatus
}

function rowFrom(r: Record<string, unknown>): PortalUsageRow {
  return {
    userId: r.user_id as string,
    name: r.name as string,
    role: r.role as string,
    teamName: (r.team_name as string | null) ?? null,
    siteName: (r.site_name as string | null) ?? null,
    teamLeaderName: (r.team_leader_name as string | null) ?? null,
    qualityAuditorName: (r.quality_auditor_name as string | null) ?? null,
    lastActiveDate: (r.last_active_date as string | null) ?? null,
    daysSinceActive: (r.days_since_active as number | null) ?? null,
    activeDays7: Number(r.active_days_7 ?? 0),
    activeDays30: Number(r.active_days_30 ?? 0),
    status: r.status as PortalUsageStatus,
  }
}

export async function loadPortalUsage(scope: PortalUsageScope, view: QaRankingView = 'team'): Promise<PortalUsageRow[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('portal_usage_report', { p_scope: scope, p_view: view })
  if (error) throw new Error(`Could not load portal usage: ${error.message}`)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(rowFrom)
}
