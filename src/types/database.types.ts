// ============================================================
// SHIKHO QA SYSTEM — Core Types
// Mirrors supabase/schema_001_foundation.sql (users table, §2)
// ============================================================

export type UserRole =
  | 'super_admin'
  | 'qa_manager'
  | 'manager'
  | 'qa_auditor'
  | 'team_lead'
  | 'agent'

export type EmploymentStage =
  | 'ojt'
  | 're_training'
  | 'active'
  | 'not_certified'
  | 'discontinued'

export type AccountStatus = 'profile_only' | 'active'

export interface UserProfile {
  id: string
  auth_id: string | null
  name: string
  email: string
  emp_id: string | null
  role: UserRole
  joining_date: string | null
  employment_stage: EmploymentStage
  ojt_start_date: string | null
  team_name: string | null
  site_name: string | null
  team_leader_id: string | null
  manager_id: string | null
  quality_auditor_id: string | null
  trainer_id: string | null
  is_active: boolean
  created_at: string
  crm_agent_id: number | null
  must_change_password: boolean
  /** profile_only = no Supabase Auth login yet (imported for matching only); active = can sign in (schema_020). */
  account_status: AccountStatus
  // What the CRM says this person reports to (schema_010). Agent -> their
  // Team Leader, team_lead -> their Manager. System-written.
  crm_reporting_to_id: number | null
  crm_reporting_to_name: string | null
  crm_reporting_to_email: string | null
  crm_org_checked_at: string | null
}

export interface AuthUser {
  id: string
  email: string
  profile: UserProfile
  role: UserRole
}

// ============================================================
// Rubric Engine (§3)
// ============================================================

export type FatalSeverity = 'critical' | 'major'

export interface Rubric {
  id: string
  name: string
  version: number
  total_points: number
  is_active: boolean
  created_by: string | null
  created_at: string
}

export interface TeamRubricMapping {
  team_name: string
  rubric_id: string
}

export interface RubricCategory {
  id: string
  rubric_id: string
  name: string
  sort_order: number
}

export interface RubricParameter {
  id: string
  category_id: string
  name: string
  points: number
  sort_order: number
}

export interface RubricErrorAttribute {
  id: string
  parameter_id: string
  description: string
  sort_order: number
}

export interface FatalParameter {
  id: string
  rubric_id: string
  description: string
  severity: FatalSeverity
  sort_order: number
}

// Nested shape used by the rubric editor — one query tree per rubric.
export interface RubricParameterWithErrors extends RubricParameter {
  rubric_error_attributes: RubricErrorAttribute[]
}

export interface RubricCategoryWithParameters extends RubricCategory {
  rubric_parameters: RubricParameterWithErrors[]
}

export interface RubricWithTree extends Rubric {
  rubric_categories: RubricCategoryWithParameters[]
  fatal_parameters: FatalParameter[]
  team_rubric_mapping: TeamRubricMapping[]
}

// ============================================================
// Audit Engine (§4) — audits table only for now (Step 3/4)
// ============================================================

export type AuditType = 'call' | 'chat' | 'complaint'
// 'disputed'/'resolved' removed (schema_048, §4 Section D) -- Disputes replaced entirely by
// Review Request, whose OWN lifecycle lives on review_requests.status, decoupled from this.
export type AuditRowStatus = 'draft' | 'submitted' | 'acknowledged'
export type CapaStatus = 'pending_reaudit' | 'passed' | 'failed_again'

export interface Audit {
  id: string
  audit_type: AuditType
  agent_id: string
  auditor_id: string
  rubric_id: string
  item_reference: string | null
  crm_lead_id: string | null
  crm_call_id: string | null
  call_started_at: string | null
  call_ended_at: string | null
  call_recording_url: string | null
  call_status: string | null
  call_destination: string | null
  score_percent: number | null
  passed: boolean | null
  /** The pass mark in force when the audit was submitted (frozen). */
  pass_mark_used: number | null
  /** The auditor's optional coaching summary (schema_012; optional since 013). Becomes required when a Special Check campaign is attached (Part B). */
  overall_feedback: string | null
  critical_fail: boolean
  status: AuditRowStatus
  re_audit_of: string | null
  capa_status: CapaStatus | null
  created_at: string
  submitted_at: string | null
}

// Derived, not stored — computed per CRM call for the call-list view (§10).
export type CallAuditStatus = 'available' | 'in_progress_mine' | 'taken' | 'audited'

// TS3P and BPO have always referred to the same channel (Third Party Telesales/BPO vendor) — consolidated
// to TS3P only, schema_039 (2026-09-27). Existing 'BPO' rows are migrated, not left as duplicates.
export const TEAM_NAMES = [
  'Telesales',
  'CX Non-Voice',
  'CX Inbound',
  'Engagement',
  'Retention',
  'TS3P',
] as const

export type TeamName = (typeof TEAM_NAMES)[number]

// ============================================================
// Special Checks / Campaigns (Part B — schema_014)
// ============================================================

export interface Campaign {
  id: string
  name: string
  description: string | null
  is_archived: boolean
  /** true = every team; otherwise `team_names` lists the teams (never both, never neither). */
  all_teams: boolean
  team_names: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

/** One thing to check under a campaign (e.g. "Mentioned the new course launch?"). */
export interface CampaignCheckType {
  id: string
  campaign_id: string
  name: string
  description: string | null
  sort_order: number
  is_archived: boolean
  created_at: string
  updated_at: string
}

/** One predefined answer to a check — a closed list, never free text. */
export interface CampaignCheckValue {
  id: string
  check_type_id: string
  label: string
  sort_order: number
  is_archived: boolean
  /** Picking this answer is a mistake worth flagging in the Campaign Report's agent breakdown (schema_077). Admin-set, defaults to false. */
  is_mistake: boolean
  created_at: string
  updated_at: string
}
