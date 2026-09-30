'use server'

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getCallById, CrmApiError } from '@/lib/crm/client'
import type { CrmCallingHistory } from '@/lib/crm/types'

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** Re-fetches the call from the CRM server-side (never trusts the browser), same discipline as `startAudit`. */
export async function submitTeamLeadCheckAction(
  agentId: string,
  leadId: string | number,
  callId: string | number,
  answers: { checkTypeId: string; valueId: string }[],
  notes: string | null
): Promise<ActionResult<{ checkId: string }>> {
  const user = await getAuthUser()
  if (!user || user.role !== 'team_lead') return { ok: false, error: 'Only a Team Lead can log a check.' }

  let call: CrmCallingHistory | null = null
  try {
    call = await getCallById(callId, user.profile.id)
  } catch (err) {
    const clientError = err instanceof CrmApiError && err.status !== undefined && err.status >= 400 && err.status < 500
    if (!clientError) return { ok: false, error: 'Could not reach the CRM to verify this call — please try again.' }
  }
  if (!call || String(call.lead_id) !== String(leadId)) return { ok: false, error: 'That call was not found on this lead in the CRM.' }

  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.rpc('submit_team_lead_check', {
    p_agent_id: agentId,
    p_crm_lead_id: String(leadId),
    p_crm_call_id: String(callId),
    p_call_started_at: call.started_at ?? null,
    p_call_ended_at: call.ended_at ?? null,
    p_call_recording_url: call.recording_url ?? null,
    p_call_status: call.call_status ?? null,
    p_call_destination: call.destination_number ?? null,
    p_notes: notes,
    p_answers: answers.map((a) => ({ check_type_id: a.checkTypeId, value_id: a.valueId })),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, checkId: data as string }
}
