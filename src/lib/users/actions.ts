'use server'
// ============================================================
// SHIKHO QA SYSTEM — User management server actions
// Return { ok, error } objects instead of throwing: Next.js replaces
// the message of an error thrown from a server action with a generic
// one in production builds, so thrown errors would never reach the UI.
// ============================================================

import { revalidatePath } from 'next/cache'
import { writeAuditLogs } from './audit-log'
import { sendPasswordResetEmail, sendWelcomeEmail } from './mailer'
import {
  activateAccount,
  createAccount,
  requireUserAdmin,
  resetAccountPassword,
  setAccountActive,
  updateAccount,
  type TagIds,
} from './users.service'
import { validateUserInput, type UserInput } from './validation'
import type { AuthUser } from '@/types/database.types'

type Fail = { ok: false; error: string }

async function guard(): Promise<{ actor: AuthUser } | { error: string }> {
  try {
    return { actor: await requireUserAdmin() }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Forbidden.' }
  }
}

export async function createUserAction(
  input: UserInput,
  tags: TagIds
): Promise<
  | { ok: true; id: string; emailSent: boolean; tempPassword: string | null }
  | Fail
> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const parsed = validateUserInput(input)
  if (!parsed.ok) return parsed

  // The Add-user form always creates a real login (accountStatus defaults
  // to 'active' in createAccount) — only bulk import currently offers
  // profile_only. tempPassword is therefore never null on this path.
  const created = await createAccount(g.actor, parsed.value, tags)
  if (!created.ok) return created
  if (!created.tempPassword) return { ok: false, error: 'Unexpected: no password was generated.' }

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'user.created',
    table_name: 'users',
    record_id: created.id,
    after_data: { ...parsed.value, ...tags },
  }])

  let emailSent = true
  try {
    await sendWelcomeEmail(parsed.value.name, parsed.value.email, created.tempPassword)
  } catch (err) {
    emailSent = false
    console.error('Welcome email failed:', err)
  }

  revalidatePath('/admin/users')
  // The password is only handed back to the admin when the email didn't
  // go out, so they can pass it on manually.
  return { ok: true, id: created.id, emailSent, tempPassword: emailSent ? null : created.tempPassword }
}

export async function updateUserAction(
  id: string,
  input: UserInput,
  tags: TagIds
): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const parsed = validateUserInput(input)
  if (!parsed.ok) return parsed

  const updated = await updateAccount(g.actor, id, parsed.value, tags)
  if (!updated.ok) return updated

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'user.updated',
    table_name: 'users',
    record_id: id,
    before_data: updated.before,
    after_data: updated.after,
  }])

  revalidatePath('/admin/users')
  return { ok: true }
}

export async function setUserActiveAction(id: string, active: boolean): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await setAccountActive(g.actor, id, active)
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: active ? 'user.reactivated' : 'user.deactivated',
    table_name: 'users',
    record_id: id,
    before_data: { is_active: result.before },
    after_data: { is_active: active },
  }])

  revalidatePath('/admin/users')
  return { ok: true }
}

export async function resetUserPasswordAction(
  id: string
): Promise<{ ok: true; emailSent: boolean; tempPassword: string | null } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await resetAccountPassword(g.actor, id)
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'user.password_reset',
    table_name: 'users',
    record_id: id,
  }])

  let emailSent = true
  try {
    await sendPasswordResetEmail(result.name, result.email, result.tempPassword)
  } catch (err) {
    emailSent = false
    console.error('Password reset email failed:', err)
  }

  revalidatePath('/admin/users')
  return { ok: true, emailSent, tempPassword: emailSent ? null : result.tempPassword }
}

// ── Activate (profile_only -> active) ───────────────────────

export async function activateUserAction(
  id: string
): Promise<{ ok: true; emailSent: boolean; tempPassword: string | null } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await activateAccount(g.actor, id)
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'user.activated',
    table_name: 'users',
    record_id: id,
  }])

  let emailSent = true
  try {
    await sendWelcomeEmail(result.name, result.email, result.tempPassword)
  } catch (err) {
    emailSent = false
    console.error('Welcome email failed:', err)
  }

  revalidatePath('/admin/users')
  return { ok: true, emailSent, tempPassword: emailSent ? null : result.tempPassword }
}

export interface ActivateRowResult {
  id: string
  name: string
  email: string
  status: 'activated' | 'failed'
  reason?: string
  emailSent?: boolean
}

// Bulk activation — same per-row { ok/failed } reporting shape as bulk
// import, run sequentially (a handful of selected rows at a time from the
// Users screen, not hundreds — no need for bulk-import's concurrency batching).
export async function activateUsersAction(
  ids: string[]
): Promise<{ ok: true; results: ActivateRowResult[] } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const results: ActivateRowResult[] = []
  for (const id of ids) {
    const result = await activateAccount(g.actor, id)
    if (!result.ok) {
      results.push({ id, name: '', email: '', status: 'failed', reason: result.error })
      continue
    }

    await writeAuditLogs([{
      actor_id: g.actor.profile.id,
      action: 'user.activated',
      table_name: 'users',
      record_id: id,
    }])

    let emailSent = true
    try {
      await sendWelcomeEmail(result.name, result.email, result.tempPassword)
    } catch (err) {
      emailSent = false
      console.error('Welcome email failed for', result.email, err)
    }
    results.push({ id, name: result.name, email: result.email, status: 'activated', emailSent })
  }

  revalidatePath('/admin/users')
  return { ok: true, results }
}
