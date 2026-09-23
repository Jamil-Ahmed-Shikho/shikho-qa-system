'use server'
// ============================================================
// SHIKHO QA SYSTEM — Audit draft creation (§10 step 3-4)
// RLS on `audits` (schema_005) already restricts who can insert/
// delete rows and to what — the checks below are defense-in-depth
// for clear error messages, not the actual authorization boundary.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getCallsForLead } from '@/lib/crm/client'
import { findCallOwner } from '@/lib/audits/agent-matching'
import { decideAuditAgent } from '@/lib/audits/agent-decision'
import type { CrmCallingHistory } from '@/lib/crm/types'

async function requireAuditor() {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(user.role)) {
    throw new Error('Forbidden — only QA roles can start an audit.')
  }
  return user
}

// Takes only IDs from the browser. The call itself (recording, times,
// status) is re-fetched from the CRM here — a client-supplied call object
// could otherwise store any recording reference or call ID it liked.
//
// `pickedAgentId` is the auditor's manual pick and only counts when the
// call couldn't be matched to one of our users: for a matched call the
// server attaches the audit to the real owner and ignores whatever the
// browser sent (see decideAuditAgent).
export async function startAudit(leadId: string | number, callId: string | number, pickedAgentId: string | null) {
  const user = await requireAuditor()

  let call: CrmCallingHistory | undefined
  try {
    call = (await getCallsForLead(Number(leadId), user.profile.id)).find((c) => String(c.id) === String(callId))
  } catch {
    throw new Error('Could not reach the CRM to verify this call — please try again.')
  }
  if (!call) throw new Error('That call was not found on this lead in the CRM.')

  // Who really took this call. A matched call is attached to that person;
  // a Team Lead may only audit a call owned by one of their own agents
  // (§2 — RLS enforces it too, this gives a clear reason). An unmatched
  // call falls back to the auditor's manual pick.
  const owner = await findCallOwner(call.created_by, user.profile.id)
  const decision = decideAuditAgent({
    viewerRole: user.role,
    viewerId: user.profile.id,
    owner,
    clientAgentId: pickedAgentId,
  })
  if (!decision.ok) throw new Error(decision.error)
  const agentId = decision.agentId

  const supabase = await getSupabaseServer()

  const { data: agent, error: agentError } = await supabase
    .from('users')
    .select('team_name')
    .eq('id', agentId)
    .single()
  if (agentError || !agent) throw new Error('Could not load the selected agent.')
  if (!agent.team_name) throw new Error('This agent has no team assigned — set one before auditing them.')

  const { data: mapping, error: mappingError } = await supabase
    .from('team_rubric_mapping')
    .select('rubric_id, rubrics!inner(is_active, created_at)')
    .eq('team_name', agent.team_name)
    .eq('rubrics.is_active', true)
    .order('created_at', { referencedTable: 'rubrics', ascending: false })
    .limit(1)
    .maybeSingle()
  if (mappingError) throw new Error(mappingError.message)
  if (!mapping) {
    throw new Error(
      `No active rubric is mapped to "${agent.team_name}" — set one up in Rubric Admin first.`
    )
  }

  const { data, error } = await supabase
    .from('audits')
    .insert({
      audit_type: 'call',
      agent_id: agentId,
      auditor_id: user.profile.id,
      rubric_id: mapping.rubric_id,
      crm_lead_id: String(call.lead_id),
      crm_call_id: String(call.id),
      call_started_at: call.started_at,
      call_ended_at: call.ended_at,
      call_recording_url: call.recording_url,
      call_status: call.call_status,
      call_destination: call.destination_number ?? call.destination ?? null,
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) {
    // Unique violation on crm_call_id — someone else claimed it first.
    if (error.code === '23505') {
      throw new Error('This call was just claimed by another auditor — refresh the list.')
    }
    throw new Error(error.message)
  }

  revalidatePath(`/audits/leads/${call.lead_id}`)
  return data.id as string
}

export async function releaseDraft(auditId: string, leadId: string) {
  await requireAuditor()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('audits').delete().eq('id', auditId).eq('status', 'draft')
  if (error) throw new Error(error.message)
  revalidatePath(`/audits/leads/${leadId}`)
}
