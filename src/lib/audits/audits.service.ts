// ============================================================
// SHIKHO QA SYSTEM — Audit status enrichment (§10 step 2)
// Read-only — server components only
// ============================================================

import { getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import type { CallAuditStatus } from '@/types/database.types'

export interface CallStatusEntry {
  status: CallAuditStatus
  auditId: string
  auditorName: string | null
  /** Phase 3 (schema_073): which kind of row this call's status comes from — 'audit' for every
   *  existing caller/row (the column defaults to it), 'sample_check' for a logged Sample Check. */
  checkMode: 'audit' | 'sample_check'
}

export async function getCallStatusMap(
  crmCallIds: string[]
): Promise<Map<string, CallStatusEntry>> {
  const result = new Map<string, CallStatusEntry>()
  if (crmCallIds.length === 0) return result

  const user = await getAuthUser()
  if (!user) return result

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('audits')
    .select('id, crm_call_id, auditor_id, status, check_mode, auditor:users!audits_auditor_id_fkey(name)')
    .in('crm_call_id', crmCallIds)

  if (error) throw new Error(error.message)

  for (const row of data ?? []) {
    const auditorName = (row.auditor as unknown as { name: string } | null)?.name ?? null
    let status: CallAuditStatus
    if (row.status === 'draft') {
      status = row.auditor_id === user.profile.id ? 'in_progress_mine' : 'taken'
    } else {
      status = 'audited'
    }
    result.set(row.crm_call_id as string, { status, auditId: row.id, auditorName, checkMode: row.check_mode as 'audit' | 'sample_check' })
  }

  return result
}
