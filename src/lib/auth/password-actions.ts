'use server'
// ============================================================
// SHIKHO QA SYSTEM — Forced password change + self-service "Forgot password?"
// The password update and the must_change_password flag clear happen
// together on the server. If the browser cleared the flag itself, a
// user could skip changing the emailed temporary password.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { MIN_PASSWORD_LENGTH } from '@/lib/users/constants'
import { issueNewTempPassword } from '@/lib/users/users.service'
import { sendSelfServicePasswordResetEmail } from '@/lib/users/mailer'
import { writeAuditLogs } from '@/lib/users/audit-log'

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

// ── Self-service "Forgot password?" (2026-11-05, Jamil — a login-page link matching the
// Complaint Management System's own) ────────────────────────────────────────────────────
//
// No signed-in actor at all — this runs from the public login page, by anyone. Always returns
// the same { ok: true }, whatever actually happened (no account for that email, the account has
// no real login yet, a recent reset already went out, or the write itself failed) — never
// revealing which emails are registered, a standard anti-enumeration practice. Real problems are
// only ever logged server-side (console.error), never surfaced to the caller.
//
// Issues a FRESH temporary password rather than a click-a-link-to-set-your-own flow: same
// mechanism, same email layout and the same forced-change-on-next-sign-in step this system
// already has (resetAccountPassword(), the admin "Reset password" button, and the Nov 2026
// bulk-resend to everyone who'd never logged in) — not a second, parallel password-recovery
// system with its own token/link handling to build and keep secure.
//
// Rate-limited to one reset per account per 5 minutes (checked against audit_log's own
// 'user.password_reset' entries, no new table) — so repeatedly submitting the same email, by the
// account holder or anyone else, can't spam that inbox with new-password emails.
const SELF_RESET_COOLDOWN_MS = 5 * 60 * 1000

export async function requestPasswordResetAction(rawEmail: string): Promise<{ ok: true }> {
  const email = rawEmail.trim().toLowerCase()
  if (!email || !email.includes('@')) return { ok: true }

  try {
    const admin = getSupabaseAdmin()
    const { data: target } = await admin
      .from('users')
      .select('id, auth_id, name, email, is_active, account_status')
      .eq('email', email)
      .maybeSingle()
    // No account, no real login yet (profile_only — a different, deliberate activation step,
    // §2), or deactivated: silently do nothing, same outward response either way.
    if (!target || !target.auth_id || !target.is_active || target.account_status !== 'active') return { ok: true }

    const { data: recent } = await admin
      .from('audit_log')
      .select('id')
      .eq('table_name', 'users')
      .eq('record_id', target.id)
      .eq('action', 'user.password_reset')
      .gte('created_at', new Date(Date.now() - SELF_RESET_COOLDOWN_MS).toISOString())
      .limit(1)
    if (recent && recent.length > 0) return { ok: true }

    const result = await issueNewTempPassword(target.id, target.auth_id)
    if (!result.ok) {
      console.error('requestPasswordResetAction: issueNewTempPassword failed:', result.error)
      return { ok: true }
    }

    await sendSelfServicePasswordResetEmail(target.name, target.email, result.tempPassword)
    await writeAuditLogs([{
      actor_id: target.id, action: 'user.password_reset', table_name: 'users', record_id: target.id,
      after_data: { reason: 'self-service forgot-password' },
    }])
  } catch (err) {
    console.error('requestPasswordResetAction failed:', err instanceof Error ? err.message : String(err))
  }
  return { ok: true }
}
