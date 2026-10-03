// ============================================================
// SHIKHO QA SYSTEM — Sampling queue + target rules service (§9)
// Server-only. The queue comes from one database call (qa_agent_queue,
// schema_034) that already limits it to QA roles and to the caller's own
// agents ('mine') or everyone ('team'). NOTHING HERE SENDS EMAIL.
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { loadVintageSlabs } from '@/lib/agents/vintage.service'
import { runWeeklyTargetCompute } from './targets-runner'
import type { QueueRow } from './priority'

export type QueueView = 'mine' | 'team'

/** True when a failed read looks like "schema_034 isn't applied yet". */
export function isMissingTargetsSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /(qa_agent_queue|audit_target_rules|revenue_target_rules|agent_weekly_audit_target|set_audit_target_rule|set_revenue_target_rule)/i.test(m)
    && /(does not exist|schema cache|could not find)/i.test(m)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function loadQueue(view: QueueView): Promise<QueueRow[]> {
  const supabase = await getSupabaseServer()

  // Recompute THIS week's targets on every load (idempotent; cheap — schema_034's own comment).
  // 2026-10-03: this used to run only when NO row existed yet for the week, so an admin's
  // same-week target-rule edit (schema_035's own documented intent: "an admin's rule change
  // dated 'current' still applies within the week in progress") silently sat unreflected on
  // this screen until the next day's cron, since compute_weekly_audit_targets() was simply never
  // called again once the week had any rows at all. The function only ever touches base_target on
  // an update (the +1 bonus, once decided for the week, is untouched — schema_035), so running it
  // unconditionally is safe and matches what was already documented as the intended behaviour.
  const r = await runWeeklyTargetCompute()
  if (!r.ok) console.error('compute_weekly_audit_targets failed:', r.error)

  const { data, error } = await supabase.rpc('qa_agent_queue', { p_view: view })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((r) => ({
    agentId: r.agent_id,
    name: r.name,
    email: r.email,
    teamName: r.team_name,
    siteName: r.site_name,
    stage: r.employment_stage,
    vintageLabel: r.vintage_label,
    hasTarget: r.has_target,
    baseTarget: num(r.base_target),
    bonusApplied: r.bonus_applied,
    bonusReasons: r.bonus_reasons ?? [],
    finalTarget: num(r.final_target),
    targetFrozen: r.target_frozen,
    doneThisWeek: Number(r.done_this_week),
    lastAuditedAt: r.last_audited_at,
    lastCoachedAt: r.last_coached_at,
    lastWeekUsd: num(r.last_week_usd),
    thisWeekUsd: num(r.this_week_usd),
    lastWeekComputed: r.last_week_computed,
    lastWeekRevenueTargetUsd: num(r.last_week_revenue_target_usd),
    ryg: r.ryg,
    criticalRecent: r.critical_recent,
    onPip: r.on_pip,
    zeroStreak: Number(r.zero_streak),
  }))
}

// ── Admin: the rules ────────────────────────────────────────

export interface TargetRuleRow {
  id: string
  isOjt: boolean
  vintageLabel: string | null
  teamName: string | null
  value: number
  effectiveFrom: string
}

export interface TargetRules {
  audit: TargetRuleRow[]
  revenue: TargetRuleRow[]
  /** vintage slab labels for the picker, in order (OJT is handled separately) */
  slabLabels: string[]
}

export async function loadTargetRules(): Promise<TargetRules> {
  const supabase = await getSupabaseServer()
  const [a, r, slabs] = await Promise.all([
    supabase.from('audit_target_rules').select('id, stage, vintage_label, team_name, weekly_audit_target, effective_from').order('effective_from', { ascending: false }),
    supabase.from('revenue_target_rules').select('id, stage, vintage_label, team_name, weekly_revenue_target_usd, effective_from').order('effective_from', { ascending: false }),
    loadVintageSlabs(),
  ])
  if (a.error) throw new Error(a.error.message)
  if (r.error) throw new Error(r.error.message)
  const map = (rows: Row[] | null, col: string): TargetRuleRow[] =>
    (rows ?? []).map((x) => ({
      id: x.id, isOjt: x.stage === 'ojt' || x.stage === 're_training', vintageLabel: x.vintage_label, teamName: x.team_name,
      value: Number(x[col]), effectiveFrom: x.effective_from,
    }))
  return {
    audit: map(a.data, 'weekly_audit_target'),
    revenue: map(r.data, 'weekly_revenue_target_usd'),
    slabLabels: slabs.filter((s) => s.minDays !== null).map((s) => s.label),
  }
}
