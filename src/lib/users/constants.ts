// ============================================================
// SHIKHO QA SYSTEM — User management constants (§2, §7)
// Pure module — safe to import from client or server code.
// ============================================================

import type { EmploymentStage, UserRole } from '@/types/database.types'

export const USER_ROLES: { value: UserRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'qa_manager', label: 'QA Manager' },
  { value: 'manager', label: 'Manager' },
  { value: 'qa_auditor', label: 'QA Auditor' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'agent', label: 'Agent' },
]

export const EMPLOYMENT_STAGES: { value: EmploymentStage; label: string }[] = [
  { value: 'ojt', label: 'OJT' },
  { value: 're_training', label: 'Re-training' },
  { value: 'active', label: 'Active' },
  { value: 'not_certified', label: 'Not certified' },
  { value: 'discontinued', label: 'Discontinued' },
]

export const SITE_NAMES = ['Dhaka', 'Jashore'] as const

// Who can be tagged in each supervisor field. A Team Lead's manager_id
// points at a Manager — or at a QA Manager, since BPO reports to the QA
// Manager directly. Trainers have no dedicated role, so any non-agent.
export const TAG_FIELDS = {
  team_leader_id: { label: 'Team Leader', roles: ['team_lead'] as UserRole[] },
  manager_id: { label: 'Manager', roles: ['manager', 'qa_manager'] as UserRole[] },
  quality_auditor_id: { label: 'QA Auditor', roles: ['qa_auditor'] as UserRole[] },
  trainer_id: { label: 'Trainer', roles: ['super_admin', 'qa_manager', 'manager', 'qa_auditor', 'team_lead'] as UserRole[] },
} as const

export type TagField = keyof typeof TAG_FIELDS

export const MIN_PASSWORD_LENGTH = 10

// Privileged roles can only be granted (or their holders edited) by a
// super_admin — otherwise a qa_manager could promote themselves or
// tamper with a super_admin account. Enforced server-side in
// users.service.ts; the form uses the same rule to hide options.
// A Manager is a business role (not a QA-system privilege), so a
// qa_manager may provision them alongside auditors/team leads/agents.
const QA_MANAGER_CAN_MANAGE: UserRole[] = ['manager', 'qa_auditor', 'team_lead', 'agent']

export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'super_admin') return true
  if (actorRole === 'qa_manager') return QA_MANAGER_CAN_MANAGE.includes(targetRole)
  return false
}
