'use server'
// ============================================================
// SHIKHO QA SYSTEM — target rule server actions (§9)
// Return { ok, error } objects, never throw (§14). Writes go through the
// schema_034 functions (admins only, append-only, never earlier than the
// current sales week); the role check here only gives a friendlier message.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'

export type RuleKind = 'audit' | 'revenue'

export interface RuleInput {
  kind: RuleKind
  /** 'ojt' or a vintage slab label */
  group: string
  /** null = all teams */
  team: string | null
  value: number
  from: 'current' | 'next'
}

export async function setTargetRuleAction(input: RuleInput): Promise<{ ok: true; effectiveFrom: string } | { ok: false; error: string }> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    if (!['super_admin', 'qa_manager'].includes(user.role)) return { ok: false, error: 'Only a Super Admin or QA Manager can change targets.' }
    if (!Number.isFinite(input.value) || input.value < 0) return { ok: false, error: 'Enter a number, zero or more.' }
    if (input.kind === 'audit' && (!Number.isInteger(input.value) || input.value > 100)) return { ok: false, error: 'An audit target is a whole number from 0 to 100.' }
    if (!input.group) return { ok: false, error: 'Choose OJT or a vintage slab.' }

    const isOjt = input.group === 'ojt'
    const supabase = await getSupabaseServer()
    const args = { p_ojt: isOjt, p_label: isOjt ? null : input.group, p_team: input.team, p_value: input.value, p_from: input.from }
    const { data, error } = input.kind === 'audit'
      ? await supabase.rpc('set_audit_target_rule', args)
      : await supabase.rpc('set_revenue_target_rule', args)
    if (error) return { ok: false, error: error.message }
    await writeAuditLogs([{
      actor_id: user.profile.id,
      action: input.kind === 'audit' ? 'audit_target.set' : 'revenue_target.set',
      table_name: input.kind === 'audit' ? 'audit_target_rules' : 'revenue_target_rules',
      record_id: null,
      after_data: { group: input.group, team: input.team, value: input.value, effective_from: data },
    }])
    revalidatePath('/admin/targets')
    revalidatePath('/dashboard/auditor')
    return { ok: true, effectiveFrom: String(data) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}
