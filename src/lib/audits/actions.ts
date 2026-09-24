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
import { CrmApiError, getCallById } from '@/lib/crm/client'
import { findCallOwner } from '@/lib/audits/agent-matching'
import { decideAuditAgent } from '@/lib/audits/agent-decision'
import type { CrmCallingHistory } from '@/lib/crm/types'
import { crmTimestamp } from '@/lib/crm/time.mjs'
import { pickNewestMappings, type MappingRow } from '@/lib/audits/rubric-mapping'

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

  // One call, not the lead's whole call list (which the page had just
  // fetched seconds earlier). It is still fetched from the CRM here, never
  // taken from the browser, and must belong to the lead the auditor was
  // looking at. Any 4xx (the CRM answers a nonexistent id with 405) means
  // "no such call"; anything else is a connection problem.
  let call: CrmCallingHistory | null = null
  try {
    call = await getCallById(callId, user.profile.id)
  } catch (err) {
    const clientError = err instanceof CrmApiError && err.status !== undefined && err.status >= 400 && err.status < 500
    if (!clientError) throw new Error('Could not reach the CRM to verify this call — please try again.')
  }
  if (!call || String(call.lead_id) !== String(leadId)) throw new Error('That call was not found on this lead in the CRM.')

  // Who really took this call. A matched call is attached to that person;
  // a Team Lead may only audit a call owned by one of their own agents
  // (§2 — RLS enforces it too, this gives a clear reason). An unmatched
  // call falls back to the auditor's manual pick.
  // The rubric mappings don't depend on who owns the call, so they load in
  // parallel with the owner lookup instead of after two more round trips.
  const [owner, mappings] = await Promise.all([findCallOwner(call.created_by, user.profile.id), loadActiveRubricMappings()])
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

  // The team's newest ACTIVE rubric (same rule as before, chosen from the
  // mappings fetched above).
  const mapping = mappings.get(agent.team_name)
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
      // The CRM's call times are zoneless Dhaka local time — pin the zone or
      // Postgres stores them 6 hours late (see src/lib/crm/time.mjs).
      call_started_at: crmTimestamp(call.started_at),
      call_ended_at: crmTimestamp(call.ended_at),
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

/** team_name -> its newest active rubric (team_rubric_mapping is a handful of rows). */
async function loadActiveRubricMappings(): Promise<Map<string, { rubric_id: string }>> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('team_rubric_mapping')
    .select('team_name, rubric_id, rubrics!inner(is_active, created_at)')
    .eq('rubrics.is_active', true)
  if (error) throw new Error(error.message)
  return pickNewestMappings((data ?? []) as unknown as MappingRow[])
}

export async function releaseDraft(auditId: string, leadId: string) {
  await requireAuditor()
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('audits').delete().eq('id', auditId).eq('status', 'draft')
  if (error) throw new Error(error.message)
  revalidatePath(`/audits/leads/${leadId}`)
}
