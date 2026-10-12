'use server'

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export async function setCoachingTargetAction(weeklyTarget: number): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return { ok: false, error: 'Only a Super Admin or QA Manager can set the coaching target.' }
  }
  if (!Number.isInteger(weeklyTarget) || weeklyTarget <= 0) {
    return { ok: false, error: 'The weekly coaching target must be a positive whole number.' }
  }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('set_qa_coaching_target', { p_weekly_target: weeklyTarget })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/reports/qa-auditor-ranking')
  return { ok: true }
}

export interface ImpactWeightsInput {
  audit: number
  coaching: number
  salesGrowth: number
  vintageTarget: number
  agentRecovery: number
  zeroSeller: number
}

export async function setImpactWeightsAction(weights: ImpactWeightsInput): Promise<ActionResult> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return { ok: false, error: 'Only a Super Admin or QA Manager can set the Impact Report weights.' }
  }
  const values = Object.values(weights)
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
    return { ok: false, error: 'Each weight must be a number between 0 and 100.' }
  }
  const sum = values.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 100) > 0.01) {
    return { ok: false, error: `The six weights must add up to 100 — they currently add up to ${sum}.` }
  }
  const supabase = await getSupabaseServer()
  const { error } = await supabase.rpc('set_qa_impact_weights', {
    p_audit: weights.audit, p_coaching: weights.coaching, p_sales_growth: weights.salesGrowth,
    p_vintage_target: weights.vintageTarget, p_agent_recovery: weights.agentRecovery, p_zero_seller: weights.zeroSeller,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/reports/qa-auditor-ranking')
  return { ok: true }
}
