// ============================================================
// SHIKHO QA SYSTEM — audit-submitted emails (new, 2026-10-02, Jamil's own
// brief): the agent gets their result, cc'd to their Team Leader; their
// Manager and every QA Manager get a separate alert ONLY when the audit
// is a critical fatal or falls in the Red band on its own score.
//
// Loads with the service role (getSupabaseAdmin) — sending this email
// needs data across several people (agent, auditor, Team Lead, Manager,
// every QA Manager) that no single viewer's own RLS would return in one
// read, the same reason PIP's notifications.ts and the Briefings digest
// both load with the service role too.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'
import { getLeadSummary } from '@/lib/crm/client'
import { agentVintage, DEFAULT_VINTAGE_SLABS, type VintageSlab } from '@/lib/agents/vintage'

export interface ParameterRow {
  name: string
  categoryName: string
  points: number
  pointsAwarded: number
  passed: boolean
  feedback: string | null
}

export interface FatalRow {
  description: string
  severity: 'critical' | 'major'
  feedback: string | null
}

export interface AuditEmailData {
  auditId: string
  agentId: string
  agentName: string
  agentEmail: string | null
  agentEmpId: string | null
  agentTeamName: string | null
  agentVintageLabel: string | null
  teamLeaderId: string | null
  teamLeaderName: string | null
  teamLeaderEmail: string | null
  managerId: string | null
  managerName: string | null
  managerEmail: string | null
  auditorName: string
  rubricName: string
  callStartedAt: string | null
  callEndedAt: string | null
  callDestination: string | null
  crmLeadId: string | null
  distributionList: string | null
  contactStage: string | null
  submittedAt: string
  scorePercent: number
  passed: boolean
  criticalFail: boolean
  passMarkUsed: number
  overallFeedback: string | null
  parameters: ParameterRow[]
  fatals: FatalRow[]
}

export interface QaManagerRecipient {
  id: string
  name: string
  email: string
}

/** Everyone actually reachable: is_active AND account_status='active' (a real login exists) — same
 * eligibility rule used everywhere else an email goes out (Briefings digest, PIP notifications, §5/§6.4). */
function hasRealLogin(u: { is_active: boolean | null; account_status: string | null; email: string | null }): boolean {
  return !!u.is_active && u.account_status === 'active' && !!u.email
}

export async function loadAuditEmailData(auditId: string): Promise<AuditEmailData | null> {
  const supabase = getSupabaseAdmin()

  const { data: audit, error } = await supabase
    .from('audits')
    .select(`
      id, agent_id, auditor_id, rubric_id, call_started_at, call_ended_at, call_destination, crm_lead_id, submitted_at,
      score_percent, passed, critical_fail, pass_mark_used, overall_feedback,
      agent:users!audits_agent_id_fkey(id, name, email, emp_id, team_name, joining_date, employment_stage, is_active, account_status, team_leader_id),
      auditor:users!audits_auditor_id_fkey(name),
      rubric:rubrics(name)
    `)
    .eq('id', auditId)
    .maybeSingle()
  if (error) throw new Error(`Could not load audit for email: ${error.message}`)
  if (!audit) return null

  type OneOrMany<T> = T | T[] | null
  const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const agent = one(audit.agent as OneOrMany<{
    id: string; name: string; email: string | null; emp_id: string | null; team_name: string | null
    joining_date: string | null; employment_stage: string; is_active: boolean | null; account_status: string | null; team_leader_id: string | null
  }>)
  const auditor = one(audit.auditor as OneOrMany<{ name: string }>)
  const rubric = one(audit.rubric as OneOrMany<{ name: string }>)
  if (!agent || !auditor || !rubric) throw new Error('Audit email data is missing agent, auditor, or rubric.')

  // Vintage is informational here (§6.1) — the current slab set is read with the service role
  // rather than the session-scoped loadVintageSlabs(), since this runs in a background after()
  // callback with no real viewer; falling back to the built-in defaults on a read failure is the
  // same safe behaviour vintage.service.ts itself uses.
  let slabs: VintageSlab[] = DEFAULT_VINTAGE_SLABS
  const { data: slabRows } = await supabase.from('vintage_slabs').select('label, min_days, max_days').is('effective_to', null).order('sort_order')
  if (slabRows && slabRows.length > 0) {
    slabs = slabRows.map((r) => ({ label: r.label as string, minDays: r.min_days as number | null, maxDays: r.max_days as number | null }))
  }
  const vintage = agentVintage({ employment_stage: agent.employment_stage, joining_date: agent.joining_date }, slabs)

  // Distribution list / contact stage come from the CRM (§10) — best-effort: a CRM failure (an
  // expired token, a timeout) must not break the email, so both are simply left null rather than
  // thrown. actorId is the auditor's own id, matching buildLogRefId's "trace back to who opened it".
  let distributionList: string | null = null
  let contactStage: string | null = null
  if (audit.crm_lead_id) {
    try {
      const lead = await getLeadSummary(audit.crm_lead_id, audit.auditor_id)
      if (lead) {
        distributionList = lead.distributionList
        contactStage = lead.stage
      }
    } catch (err) {
      console.error('Could not load lead summary for audit email:', err)
    }
  }

  let teamLeaderId: string | null = null
  let teamLeaderName: string | null = null
  let teamLeaderEmail: string | null = null
  let managerId: string | null = null
  let managerName: string | null = null
  let managerEmail: string | null = null

  if (agent.team_leader_id) {
    const { data: tl } = await supabase
      .from('users')
      .select('id, name, email, is_active, account_status, manager_id')
      .eq('id', agent.team_leader_id)
      .maybeSingle()
    if (tl) {
      teamLeaderId = tl.id
      teamLeaderName = tl.name
      if (hasRealLogin(tl)) teamLeaderEmail = tl.email
      if (tl.manager_id) {
        const { data: mgr } = await supabase
          .from('users')
          .select('id, name, email, is_active, account_status')
          .eq('id', tl.manager_id)
          .maybeSingle()
        if (mgr) {
          managerId = mgr.id
          managerName = mgr.name
          if (hasRealLogin(mgr)) managerEmail = mgr.email
        }
      }
    }
  }

  const [paramsRes, fatalsRes] = await Promise.all([
    supabase
      .from('audit_parameter_results')
      .select('passed, points_awarded, feedback, rubric_parameters(name, points, rubric_categories(name))')
      .eq('audit_id', auditId),
    supabase
      .from('audit_fatal_results')
      .select('severity, feedback, fatal_parameters(description)')
      .eq('audit_id', auditId),
  ])
  if (paramsRes.error) throw new Error(`Could not load parameter results for email: ${paramsRes.error.message}`)
  if (fatalsRes.error) throw new Error(`Could not load fatal results for email: ${fatalsRes.error.message}`)

  const parameters: ParameterRow[] = (paramsRes.data ?? []).map((r) => {
    const p = one(r.rubric_parameters as OneOrMany<{ name: string; points: number; rubric_categories: OneOrMany<{ name: string }> }>)
    const cat = p ? one(p.rubric_categories) : null
    return {
      name: p?.name ?? 'Unknown parameter',
      categoryName: cat?.name ?? '',
      points: p ? Number(p.points) : 0,
      pointsAwarded: Number(r.points_awarded),
      passed: r.passed,
      feedback: r.feedback,
    }
  })

  const fatals: FatalRow[] = (fatalsRes.data ?? []).map((r) => {
    const f = one(r.fatal_parameters as OneOrMany<{ description: string }>)
    return { description: f?.description ?? 'Unknown fatal', severity: r.severity as 'critical' | 'major', feedback: r.feedback }
  })

  return {
    auditId: audit.id,
    agentId: agent.id,
    agentName: agent.name,
    agentEmail: hasRealLogin(agent) ? agent.email : null,
    agentEmpId: agent.emp_id,
    agentTeamName: agent.team_name,
    agentVintageLabel: vintage.label,
    teamLeaderId,
    teamLeaderName,
    teamLeaderEmail,
    managerId,
    managerName,
    managerEmail,
    auditorName: auditor.name,
    rubricName: rubric.name,
    callStartedAt: audit.call_started_at,
    callEndedAt: audit.call_ended_at,
    callDestination: audit.call_destination,
    crmLeadId: audit.crm_lead_id,
    distributionList,
    contactStage,
    submittedAt: audit.submitted_at,
    scorePercent: Number(audit.score_percent),
    passed: audit.passed,
    criticalFail: audit.critical_fail,
    passMarkUsed: Number(audit.pass_mark_used),
    overallFeedback: audit.overall_feedback,
    parameters,
    fatals,
  }
}

/** Every QA Manager with a real login — used by Review Requests (review-requests/actions.ts) to
 * notify whoever a request might land with. Deliberately scoped to the one role, not widened here
 * even though the audit alert below now also wants Super Admin — §14's own lesson: this helper has
 * another caller that was never asked to start notifying Super Admin too, so that's a separate
 * function (loadAuditAlertStaff), not a broadening of this one. */
export async function loadQaManagers(): Promise<QaManagerRecipient[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, is_active, account_status')
    .eq('role', 'qa_manager')
  if (error) throw new Error(`Could not load QA Managers for the audit alert: ${error.message}`)
  return (data ?? []).filter(hasRealLogin).map((u) => ({ id: u.id, name: u.name, email: u.email as string }))
}

/** QA Manager + Super Admin ("Admin") with a real login — the Red/Critical-fatal/Failed audit
 * alert's recipients, confirmed by Jamil 2026-10-04: "QA manager, Respective Team's Manager and
 * Admin will get emails for Failed audit, Critical error, red marked audits only." Used only by
 * the audit-submission alert (scoring-actions.ts) — see loadQaManagers() above for why this is its
 * own function rather than that one widened. */
export async function loadAuditAlertStaff(): Promise<QaManagerRecipient[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, is_active, account_status')
    .in('role', ['qa_manager', 'super_admin'])
  if (error) throw new Error(`Could not load QA Manager/Admin staff for the audit alert: ${error.message}`)
  return (data ?? []).filter(hasRealLogin).map((u) => ({ id: u.id, name: u.name, email: u.email as string }))
}

/** This specific audit's own outcome, not the agent's rolling 4-week RYG status — computable the
 * instant it's submitted, no need to wait for a recompute. A Claude-made call (Jamil asked for
 * "Red, fatal audit" alerts without spelling out which "Red" — the agent's rolling status or this
 * one audit's own score); this reads it as the audit's own score falling below the pass mark actually
 * used for it, the same number already frozen on the row (audits.pass_mark_used, §4) — paired with
 * critical_fail, which is already an audit-level fact. Flag if "Red" was meant to be the agent's
 * rolling RYG status instead. */
export function qualifiesForRedFatalAlert(d: Pick<AuditEmailData, 'passed'>): boolean {
  // §4: audits.passed = no critical fatal AND score >= the pass mark used — so a critical fatal
  // always implies passed=false already; checking just `!passed` covers both triggers in one go.
  return !d.passed
}
