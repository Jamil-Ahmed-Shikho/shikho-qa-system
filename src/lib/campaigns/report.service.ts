// ============================================================
// SHIKHO QA SYSTEM — Campaign Report (Part B3)
// Server-only. The heavy lifting (role/chain scoping, the aggregate query)
// is done in the database (schema_017, SECURITY DEFINER, the same pattern
// as manager_agent_stats) — this just calls it and shapes the result.
//
// Access (confirmed, corrected twice after the first build of this step —
// see CLAUDE.md §2's "My View / Team View" note for the standing principle
// this follows for later steps):
//   - Super Admin / QA Manager / QA Auditor: Team View — every campaign's
//     every audit, company-wide. A QA Auditor is NOT scoped to their
//     assigned agents here (unlike, say, the audit queue).
//   - Manager: only their own reporting chain, always.
//   - Team Lead: only their own team's agents, always — the same scoping
//     Team Lead gets everywhere else in the app.
// requireReportAccess() is defence in depth — the SQL functions return
// zero rows for anyone else regardless, so a stale check here can't leak
// data, only mis-word an error message.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { listManagerOptions, type ManagerOption } from '@/lib/manager/dashboard.service'
import { listCampaigns } from './campaigns.service'
import type { AuthUser } from '@/types/database.types'

export const REPORT_ROLES = ['super_admin', 'qa_manager', 'qa_auditor', 'manager', 'team_lead'] as const

/** The roles that see company-wide data and may narrow to one manager's chain via the picker (Team View). Manager and Team Lead are always locked to their own scope and never see that picker. */
const UNRESTRICTED_REPORT_ROLES = ['super_admin', 'qa_manager', 'qa_auditor'] as const
export function canNarrowByManager(role: string): boolean {
  return (UNRESTRICTED_REPORT_ROLES as readonly string[]).includes(role)
}

/** Who may press "Send report" on the Campaign Mistake Report — QA Auditors send this in practice too, not just QA Manager/Admin (Jamil, 2026-10-08). */
export const MISTAKE_REPORT_SEND_ROLES = ['super_admin', 'qa_manager', 'qa_auditor'] as const

export async function requireReportAccess(): Promise<AuthUser> {
  const user = await getAuthUser()
  if (!user || !(REPORT_ROLES as readonly string[]).includes(user.role)) {
    throw new Error('Only Super Admin, QA Manager, QA Auditor, Manager or Team Lead can view the Special Check Report.')
  }
  return user
}

export interface ReportFilters {
  managerId?: string | null
  team?: string | null
  site?: string | null
  agentId?: string | null
  auditorId?: string | null
  /** yyyy-mm-dd, inclusive */
  from?: string | null
  /** yyyy-mm-dd, inclusive (converted to an exclusive upper bound internally) */
  to?: string | null
}

export interface ReportOption {
  valueId: string
  label: string
  count: number
  archived: boolean
  isMistake: boolean
}

export interface ReportCheck {
  checkTypeId: string
  name: string
  archived: boolean
  total: number
  options: ReportOption[]
}

export interface CampaignReportResult {
  campaignName: string
  campaignArchived: boolean
  /** Distinct submitted audits matching the filters that have this campaign attached. */
  auditCount: number
  checks: ReportCheck[]
}

/** Exported for its own unit test — the off-by-one here (inclusive UI date -> exclusive DB bound) is easy to get wrong. */
export function toExclusiveUpperBound(dateStr: string): string {
  // "to" is inclusive of the whole day — the database compares submitted_at
  // (a timestamp) with a plain < , so add one day to include every moment of it.
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

/** Every campaign, for the picker — same list the admin screen shows, so a report can be run for an archived one too. */
export async function listReportCampaigns() {
  await requireReportAccess()
  return listCampaigns()
}

/** The managers a Super Admin / QA Manager / QA Auditor may narrow the report to; empty (and unused) for a Manager or Team Lead, who always see only their own scope. */
export async function listReportManagers(user: AuthUser): Promise<ManagerOption[]> {
  if (!canNarrowByManager(user.role)) return []
  return listManagerOptions()
}

export interface ReportParticipants {
  agents: { id: string; name: string }[]
  auditors: { id: string; name: string }[]
}

export async function loadReportParticipants(campaignId: string, managerId: string | null): Promise<ReportParticipants> {
  await requireReportAccess()
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('campaign_report_participants', {
    p_campaign_id: campaignId,
    p_manager_id: managerId,
  })
  if (error) {
    console.error('loadReportParticipants failed:', error.code, error.message)
    throw new Error('Could not load the agent/auditor filter list. Please reload the page.')
  }
  const rows = (data ?? []) as { kind: 'agent' | 'auditor'; id: string; name: string }[]
  return {
    agents: rows.filter((r) => r.kind === 'agent').map((r) => ({ id: r.id, name: r.name })),
    auditors: rows.filter((r) => r.kind === 'auditor').map((r) => ({ id: r.id, name: r.name })),
  }
}

/**
 * The report for one campaign. A Manager's or Team Lead's own scoping is
 * enforced by the database regardless of what `filters.managerId` says
 * (schema_017 `campaign_report_scope`); that filter is only meaningful for
 * the three unrestricted roles (Super Admin / QA Manager / QA Auditor).
 */
export async function loadCampaignReport(campaignId: string, filters: ReportFilters): Promise<CampaignReportResult | null> {
  const user = await requireReportAccess()
  const supabase = await getSupabaseServer()

  const managerId = canNarrowByManager(user.role) ? (filters.managerId || null) : null
  const rpcArgs = {
    p_campaign_id: campaignId,
    p_manager_id: managerId,
    p_team_name: filters.team || null,
    p_site_name: filters.site || null,
    p_agent_id: filters.agentId || null,
    p_auditor_id: filters.auditorId || null,
    p_from: filters.from ? filters.from + 'T00:00:00Z' : null,
    p_to: filters.to ? toExclusiveUpperBound(filters.to) : null,
  }

  const [campaign, rows, countRes] = await Promise.all([
    supabase.from('campaigns').select('id, name, is_archived, campaign_check_types!campaign_check_types_campaign_id_fkey(id, name, sort_order, is_archived, campaign_check_values!campaign_check_values_check_type_id_fkey(id, label, sort_order, is_archived, is_mistake))').eq('id', campaignId).maybeSingle(),
    supabase.rpc('campaign_report', rpcArgs),
    supabase.rpc('campaign_report_audit_count', rpcArgs),
  ])

  if (campaign.error) { console.error('loadCampaignReport (campaign) failed:', campaign.error.code, campaign.error.message); throw new Error('Could not load the Special Check. Please reload the page.') }
  if (rows.error) { console.error('loadCampaignReport (distribution) failed:', rows.error.code, rows.error.message); throw new Error('Could not load the report. Please reload the page.') }
  if (countRes.error) { console.error('loadCampaignReport (count) failed:', countRes.error.code, countRes.error.message); throw new Error('Could not load the report. Please reload the page.') }
  if (!campaign.data) return null

  type RawCheck = { id: string; name: string; sort_order: number; is_archived: boolean; campaign_check_values: { id: string; label: string; sort_order: number; is_archived: boolean; is_mistake: boolean }[] | null }
  type Row = { check_type_id: string; value_id: string; answer_count: number | string }
  const counts = new Map<string, number>()
  for (const r of (rows.data ?? []) as Row[]) counts.set(`${r.check_type_id}:${r.value_id}`, Number(r.answer_count))

  // Every option the campaign has ever had (in its stable, frozen-once-used text) is shown,
  // even with zero matching answers — so a QA Manager can see "0 people picked this" as
  // plainly as any other count, not just the options that happened to be chosen.
  const checkTypes = ((campaign.data.campaign_check_types ?? []) as RawCheck[]).slice().sort((a, b) => a.sort_order - b.sort_order)
  const checks: ReportCheck[] = checkTypes.map((t) => {
    const options: ReportOption[] = [...(t.campaign_check_values ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({ valueId: v.id, label: v.label, archived: v.is_archived, isMistake: v.is_mistake, count: counts.get(`${t.id}:${v.id}`) ?? 0 }))
    return { checkTypeId: t.id, name: t.name, archived: t.is_archived, total: options.reduce((n, o) => n + o.count, 0), options }
  })

  return {
    campaignName: campaign.data.name,
    campaignArchived: campaign.data.is_archived,
    auditCount: Number(countRes.data ?? 0),
    checks,
  }
}

// ── Mistake tracking (schema_077, 2026-10-04) ────────────────
// Who picked a mistake-tagged answer, their Team Leader, and how many times
// — both within the report's current filters and lifetime — so the report
// can answer "who should I take care of", not just "what did everyone
// answer". See campaign_mistake_breakdown()'s own comment for the exact
// counting rules.

export interface MistakeOption {
  valueId: string
  checkName: string
  label: string
}

/** Every option in this report currently tagged as a mistake — the source list for the "count as a mistake" checklist filter. */
export function listMistakeOptions(report: CampaignReportResult): MistakeOption[] {
  const out: MistakeOption[] = []
  for (const check of report.checks) {
    for (const o of check.options) {
      if (o.isMistake) out.push({ valueId: o.valueId, checkName: check.name, label: o.label })
    }
  }
  return out
}

export interface MistakeRow {
  agentId: string
  agentName: string
  teamLeaderName: string | null
  mistakeCount: number
  lifetimeCount: number
  lastMistakeAt: string | null
  lastAuditId: string | null
  lastCheckName: string | null
  lastValueLabel: string | null
}

/**
 * The agent breakdown, scoped exactly like loadCampaignReport() (same role/
 * chain rules, same filters) plus which specific mistake-tagged options to
 * count this run. `valueIds` null = every mistake-tagged option in this
 * campaign (the checklist's "nothing explicitly chosen yet" default); an
 * explicit (possibly empty) array is used as-is.
 */
export async function loadCampaignMistakeBreakdown(
  campaignId: string,
  filters: ReportFilters,
  valueIds: string[] | null
): Promise<MistakeRow[]> {
  const user = await requireReportAccess()
  const supabase = await getSupabaseServer()

  const managerId = canNarrowByManager(user.role) ? (filters.managerId || null) : null
  const { data, error } = await supabase.rpc('campaign_mistake_breakdown', {
    p_campaign_id: campaignId,
    p_manager_id: managerId,
    p_team_name: filters.team || null,
    p_site_name: filters.site || null,
    p_agent_id: filters.agentId || null,
    p_auditor_id: filters.auditorId || null,
    p_from: filters.from ? filters.from + 'T00:00:00Z' : null,
    p_to: filters.to ? toExclusiveUpperBound(filters.to) : null,
    p_value_ids: valueIds,
  })
  if (error) {
    console.error('loadCampaignMistakeBreakdown failed:', error.code, error.message)
    throw new Error('Could not load the mistake breakdown. Please reload the page.')
  }

  type Row = {
    agent_id: string; agent_name: string; team_leader_name: string | null
    mistake_count: number | string; lifetime_count: number | string
    last_mistake_at: string | null; last_audit_id: string | null
    last_check_name: string | null; last_value_label: string | null
  }
  return ((data ?? []) as Row[]).map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    teamLeaderName: r.team_leader_name,
    mistakeCount: Number(r.mistake_count),
    lifetimeCount: Number(r.lifetime_count),
    lastMistakeAt: r.last_mistake_at,
    lastAuditId: r.last_audit_id,
    lastCheckName: r.last_check_name,
    lastValueLabel: r.last_value_label,
  }))
}
