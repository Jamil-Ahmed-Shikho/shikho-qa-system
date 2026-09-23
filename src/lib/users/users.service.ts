// ============================================================
// SHIKHO QA SYSTEM — User management service (§2, §7)
// Server-only. Writes use the service-role client (creating Supabase
// Auth accounts requires it) — so every function here re-checks the
// actor's role itself instead of leaning on RLS.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import type { AuthUser, UserProfile, UserRole } from '@/types/database.types'
import { canManageRole, TAG_FIELDS, type TagField } from './constants'
import { generateTempPassword } from './password'
import { validateTeamLeaderRequired, type NormalizedUserInput } from './validation'

export type TagIds = Record<TagField, string | null>
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const EMPTY_TAGS: TagIds = {
  team_leader_id: null,
  manager_id: null,
  quality_auditor_id: null,
  trainer_id: null,
}
export { EMPTY_TAGS }

// ── Guards ───────────────────────────────────────────────────

export async function requireUserAdmin(): Promise<AuthUser> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    throw new Error('Forbidden — only Super Admin / QA Manager can manage users.')
  }
  return user
}

export { canManageRole }

// ── Reads ────────────────────────────────────────────────────

export async function listUsers(): Promise<UserProfile[]> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase.from('users').select('*').order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as UserProfile[]
}

// ── Tag validation ───────────────────────────────────────────

async function validateTags(tags: TagIds, selfId?: string): Promise<string | null> {
  const entries = (Object.keys(TAG_FIELDS) as TagField[])
    .map((field) => ({ field, id: tags[field] }))
    .filter((e): e is { field: TagField; id: string } => !!e.id)
  if (entries.length === 0) return null

  for (const { field, id } of entries) {
    if (selfId && id === selfId) return `A user can't be their own ${TAG_FIELDS[field].label}.`
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('users')
    .select('id, name, role, is_active')
    .in('id', entries.map((e) => e.id))
  if (error) return error.message

  for (const { field, id } of entries) {
    const target = data?.find((u) => u.id === id)
    const label = TAG_FIELDS[field].label
    if (!target) return `${label} not found.`
    if (!target.is_active) return `${label} "${target.name}" is deactivated.`
    if (!(TAG_FIELDS[field].roles as UserRole[]).includes(target.role as UserRole)) {
      return `${label} "${target.name}" has role ${target.role}, which can't be tagged as ${label}.`
    }
  }
  return null
}

export { validateTags }

function friendlyDbError(message: string, code?: string): string {
  if (code === '23505') {
    if (message.includes('emp_id')) return 'That Employee ID is already used by another user.'
    if (message.includes('email')) return 'That email is already used by another user.'
    return 'A user with these details already exists.'
  }
  return message
}

// ── Create ───────────────────────────────────────────────────

export async function createAccount(
  actor: AuthUser,
  v: NormalizedUserInput,
  tags: TagIds
): Promise<Result<{ id: string; tempPassword: string }>> {
  if (!canManageRole(actor.role, v.role)) {
    return { ok: false, error: `Only a Super Admin can create ${v.role} accounts.` }
  }

  const tlError = validateTeamLeaderRequired(v.role, tags.team_leader_id)
  if (tlError) return { ok: false, error: tlError }

  const tagError = await validateTags(tags)
  if (tagError) return { ok: false, error: tagError }

  const admin = getSupabaseAdmin()

  const { data: emailDup } = await admin.from('users').select('id').eq('email', v.email).limit(1)
  if (emailDup && emailDup.length > 0) return { ok: false, error: 'A user with this email already exists.' }
  if (v.emp_id) {
    const { data: empDup } = await admin.from('users').select('id').eq('emp_id', v.emp_id).limit(1)
    if (empDup && empDup.length > 0) return { ok: false, error: 'That Employee ID is already used by another user.' }
  }

  const tempPassword = generateTempPassword()
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: v.email,
    password: tempPassword,
    email_confirm: true,
  })
  if (authError || !authData.user) {
    const msg = authError?.message ?? ''
    if (msg.includes('already') && msg.includes('registered')) {
      return { ok: false, error: 'An account for this email already exists in the login system.' }
    }
    console.error('auth.admin.createUser failed:', msg)
    return { ok: false, error: 'Could not create the login account.' }
  }

  const { data, error } = await admin
    .from('users')
    .insert({
      auth_id: authData.user.id,
      name: v.name,
      email: v.email,
      emp_id: v.emp_id,
      role: v.role,
      team_name: v.team_name,
      site_name: v.site_name,
      joining_date: v.joining_date,
      employment_stage: v.employment_stage,
      ojt_start_date: v.ojt_start_date,
      ...tags,
      must_change_password: true,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Don't leave an orphan login behind if the profile row failed.
    await admin.auth.admin.deleteUser(authData.user.id)
    return { ok: false, error: friendlyDbError(error?.message ?? 'Insert failed.', error?.code) }
  }

  return { ok: true, id: data.id as string, tempPassword }
}

// ── Update ───────────────────────────────────────────────────

export async function updateAccount(
  actor: AuthUser,
  id: string,
  v: NormalizedUserInput,
  tags: TagIds
): Promise<Result<{ before: UserProfile; after: UserProfile }>> {
  const admin = getSupabaseAdmin()
  const { data: before, error: loadError } = await admin.from('users').select('*').eq('id', id).single()
  if (loadError || !before) return { ok: false, error: 'User not found.' }

  if (!canManageRole(actor.role, before.role as UserRole) || !canManageRole(actor.role, v.role)) {
    return { ok: false, error: 'Only a Super Admin can edit or assign privileged roles.' }
  }
  if (id === actor.profile.id && v.role !== before.role) {
    return { ok: false, error: "You can't change your own role." }
  }

  // Same rule as the database check: it only binds active agents, so a
  // deactivated leaver's record can still be edited without a Team Leader.
  if (before.is_active) {
    const tlError = validateTeamLeaderRequired(v.role, tags.team_leader_id)
    if (tlError) return { ok: false, error: tlError }
  }

  const tagError = await validateTags(tags, id)
  if (tagError) return { ok: false, error: tagError }

  // Email is the login and the CRM identity (§10) — intentionally not
  // editable here.
  const { data: after, error } = await admin
    .from('users')
    .update({
      name: v.name,
      emp_id: v.emp_id,
      role: v.role,
      team_name: v.team_name,
      site_name: v.site_name,
      joining_date: v.joining_date,
      employment_stage: v.employment_stage,
      ojt_start_date: v.ojt_start_date,
      ...tags,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !after) return { ok: false, error: friendlyDbError(error?.message ?? 'Update failed.', error?.code) }
  return { ok: true, before: before as UserProfile, after: after as UserProfile }
}

// ── Activate / deactivate ────────────────────────────────────

export async function setAccountActive(
  actor: AuthUser,
  id: string,
  active: boolean
): Promise<Result<{ before: boolean }>> {
  if (id === actor.profile.id) return { ok: false, error: "You can't deactivate your own account." }

  const admin = getSupabaseAdmin()
  const { data: target } = await admin
    .from('users')
    .select('auth_id, role, is_active, team_leader_id')
    .eq('id', id)
    .single()
  if (!target) return { ok: false, error: 'User not found.' }
  if (!canManageRole(actor.role, target.role as UserRole)) {
    return { ok: false, error: 'Only a Super Admin can change privileged accounts.' }
  }
  // Checked before the login is un-banned below, so a rejection here
  // can't leave the login enabled while the profile stays inactive.
  if (active && target.role === 'agent' && !target.team_leader_id) {
    return { ok: false, error: 'This agent has no Team Leader. Edit them and assign one, then reactivate.' }
  }

  // Ban/unban the login too, so a deactivated user can't keep using a
  // still-valid session token.
  if (target.auth_id) {
    const { error: banError } = await admin.auth.admin.updateUserById(target.auth_id, {
      ban_duration: active ? 'none' : '876000h',
    })
    if (banError) return { ok: false, error: 'Could not update the login account.' }
  }

  const { error } = await admin.from('users').update({ is_active: active }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, before: target.is_active }
}

// ── Reset password ───────────────────────────────────────────

export async function resetAccountPassword(
  actor: AuthUser,
  id: string
): Promise<Result<{ name: string; email: string; tempPassword: string }>> {
  const admin = getSupabaseAdmin()
  const { data: target } = await admin
    .from('users')
    .select('auth_id, name, email, role')
    .eq('id', id)
    .single()
  if (!target) return { ok: false, error: 'User not found.' }
  if (!target.auth_id) return { ok: false, error: 'This user has no login account.' }
  if (!canManageRole(actor.role, target.role as UserRole)) {
    return { ok: false, error: 'Only a Super Admin can reset privileged accounts.' }
  }

  const tempPassword = generateTempPassword()
  const { error: pwError } = await admin.auth.admin.updateUserById(target.auth_id, { password: tempPassword })
  if (pwError) return { ok: false, error: 'Could not reset the password.' }

  const { error } = await admin.from('users').update({ must_change_password: true }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  return { ok: true, name: target.name, email: target.email, tempPassword }
}
