// ============================================================
// Resend login credentials to every account the Portal Usage report (schema_109/110) shows as
// "Never logged in" — Jamil's explicit instruction, 2026-11-04: "I'm seeing 6 back office and 123
// frontline never logged in. can we send their login credentials again? simply the portal access
// creation email we send when we create their access?"
//
// There is no way to literally "resend" the original welcome email's password — it's bcrypt-hashed,
// never stored in a retrievable form. This generates a fresh temporary password for each account
// (must_change_password forces them to set a real one on first login, same as a brand-new account)
// and sends the password-reset email, which uses the same "your credentials" layout as the welcome
// email. Reuses the real resetAccountPassword()/sendPasswordResetEmail() functions (the exact code
// path the Users admin screen's own "Reset password" button calls) via a standalone script, same
// pattern as activate-ts3p-accounts-20261003.mts — not a raw bypass, since issuing real credentials
// to real people is exactly the kind of action that should go through the validated path.
//
// Scope mirrors portal_usage_report()'s own "never" bucket exactly: active, the right roles, and no
// row at all in user_activity_days. All 129 matching accounts were confirmed account_status='active'
// before writing this (none are profile_only — a profile_only account has no login to reset at all,
// and would need a completely different, more consequential "activate for the first time" action).
//
//   npx tsx --env-file=.env.local scripts/resend-credentials-never-logged-in-20261104.mts            (dry run)
//   npx tsx --env-file=.env.local scripts/resend-credentials-never-logged-in-20261104.mts --live     (writes + sends real emails)
// ============================================================
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { resetAccountPassword } from '@/lib/users/users.service'
import { sendPasswordResetEmail } from '@/lib/users/mailer'
import { writeAuditLogs } from '@/lib/users/audit-log'
import type { AuthUser } from '@/types/database.types'

const LIVE = process.argv.includes('--live')
console.log(LIVE ? '=== LIVE — resetting real passwords and sending real emails ===' : '=== DRY RUN — no writes ===')

const admin = getSupabaseAdmin()

const { data: targets, error } = await admin
  .from('users')
  .select('id, name, email, role, account_status')
  .eq('is_active', true)
  .in('role', ['super_admin', 'qa_manager', 'manager', 'team_lead', 'qa_auditor', 'agent'])
if (error) throw new Error(error.message)

const { data: activeDays, error: actErr } = await admin.from('user_activity_days').select('user_id')
if (actErr) throw new Error(actErr.message)
const everActive = new Set((activeDays ?? []).map((r) => r.user_id as string))

const neverLoggedIn = (targets ?? []).filter((t) => !everActive.has(t.id))
const notActivated = neverLoggedIn.filter((t) => t.account_status !== 'active')
const toReset = neverLoggedIn.filter((t) => t.account_status === 'active').sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))

console.log(`\nNever logged in: ${neverLoggedIn.length} total (${toReset.length} have a real login to reset, ${notActivated.length} are profile_only — skipped, different action)`)
if (notActivated.length > 0) {
  console.log('\nSkipped (profile_only, no login exists to reset):')
  for (const t of notActivated) console.log(`  ${t.name} (${t.email}) — ${t.role}`)
}
console.log(`\nWill reset + email ${toReset.length} accounts:`)
for (const t of toReset) console.log(`  ${t.name} (${t.email}) — ${t.role}`)

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually reset and email.')
  process.exit(0)
}

// Minimal actor — resetAccountPassword() only reads actor.role for the canManageRole() check.
const actor = { role: 'super_admin' } as unknown as AuthUser

// Real actor id for the audit trail — Jamil's own account, since this runs at his explicit request.
const { data: jamil, error: jamilErr } = await admin.from('users').select('id').eq('email', 'jamil.ahmed@shikho.com').single()
if (jamilErr || !jamil) throw new Error(`Could not resolve the actor for the audit log: ${jamilErr?.message}`)

let sent = 0
const failures: string[] = []
for (const t of toReset) {
  const result = await resetAccountPassword(actor, t.id)
  if (!result.ok) {
    console.error(`  FAILED: ${t.name} (${t.email}) — ${result.error}`)
    failures.push(t.email)
    continue
  }
  try {
    await sendPasswordResetEmail(result.name, result.email, result.tempPassword)
    await writeAuditLogs([{
      actor_id: jamil.id, action: 'user.password_reset', table_name: 'users', record_id: t.id,
      after_data: { reason: 'bulk resend — never logged in (Portal Usage report, 2026-11-04)' },
    }])
    console.log(`  reset + emailed: ${result.name} (${result.email})`)
  } catch (err) {
    console.error(`  password reset but email FAILED: ${result.name} (${result.email}) — ${err instanceof Error ? err.message : String(err)}`)
    failures.push(t.email)
    continue
  }
  sent++
}

console.log(`\n=== Done: ${sent}/${toReset.length} reset + emailed${failures.length ? `, ${failures.length} failed: ${failures.join(', ')}` : ''} ===`)
