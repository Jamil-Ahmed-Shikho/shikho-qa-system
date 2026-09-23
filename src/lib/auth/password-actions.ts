'use server'
// ============================================================
// SHIKHO QA SYSTEM — Forced password change
// The password update and the must_change_password flag clear happen
// together on the server. If the browser cleared the flag itself, a
// user could skip changing the emailed temporary password.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { MIN_PASSWORD_LENGTH } from '@/lib/users/constants'

export async function changeOwnPassword(
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getAuthUser()
  if (!user) return { ok: false, error: 'You are not signed in.' }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    if (error.message.toLowerCase().includes('different')) {
      return { ok: false, error: 'Your new password must be different from your current one.' }
    }
    console.error('updateUser(password) failed:', error.message)
    return { ok: false, error: 'Could not update your password. Please try again.' }
  }

  // Own-row update goes through the admin client: agents/auditors have
  // no UPDATE policy on users (schema_001 restricts writes to admins).
  const admin = getSupabaseAdmin()
  const { error: flagError } = await admin
    .from('users')
    .update({ must_change_password: false })
    .eq('auth_id', user.id)
  if (flagError) return { ok: false, error: 'Password changed, but could not finish setup. Please sign in again.' }

  return { ok: true }
}
