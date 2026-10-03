// ============================================================
// Activate every profile_only TS3P account (Team Lead + agents) — Jamil's
// explicit instruction, 2026-10-03: "Activate all accounts of TS3P."
// Reuses the real activateAccount()/sendWelcomeEmail() functions (same
// logic the "Activate & invite" button in the Users UI calls) via a
// standalone script, the same pattern the real-roster-import work used —
// not a raw SQL bypass, since creating a real login + sending a real email
// is exactly the kind of consequential action that should go through the
// actual validated code path, not be reimplemented.
//
//   npx tsx --env-file=.env.local scripts/activate-ts3p-accounts-20261003.mts            (dry run)
//   npx tsx --env-file=.env.local scripts/activate-ts3p-accounts-20261003.mts --live     (writes + sends real emails)
// ============================================================
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { activateAccount } from '@/lib/users/users.service'
import { sendWelcomeEmail } from '@/lib/users/mailer'
import type { AuthUser } from '@/types/database.types'

const LIVE = process.argv.includes('--live')
console.log(LIVE ? '=== LIVE — creating real logins and sending real emails ===' : '=== DRY RUN — no writes ===')

const admin = getSupabaseAdmin()
const { data: targets, error } = await admin
  .from('users')
  .select('id, name, email, role')
  .eq('team_name', 'TS3P')
  .eq('account_status', 'profile_only')
  .order('role')
  .order('name')
if (error) throw new Error(error.message)
if (!targets || targets.length === 0) {
  console.log('No profile_only TS3P accounts found — nothing to do.')
  process.exit(0)
}

console.log(`\nWill activate ${targets.length} accounts:`)
for (const t of targets) console.log(`  ${t.name} (${t.email}) — ${t.role}`)

if (!LIVE) {
  console.log('\n--dry-run: no writes performed. Pass --live to actually activate and email.')
  process.exit(0)
}

// Minimal actor — activateAccount() only reads actor.role for the canManageRole() check.
const actor = { role: 'super_admin' } as unknown as AuthUser

let activated = 0
const failures: string[] = []
for (const t of targets) {
  const result = await activateAccount(actor, t.id)
  if (!result.ok) {
    console.error(`  FAILED: ${t.name} (${t.email}) — ${result.error}`)
    failures.push(t.email)
    continue
  }
  try {
    await sendWelcomeEmail(result.name, result.email, result.tempPassword)
    console.log(`  activated + emailed: ${result.name} (${result.email})`)
  } catch (err) {
    console.error(`  activated but email FAILED: ${result.name} (${result.email}) — ${err instanceof Error ? err.message : String(err)}`)
  }
  activated++
}

console.log(`\n=== Done: ${activated}/${targets.length} activated${failures.length ? `, ${failures.length} failed: ${failures.join(', ')}` : ''} ===`)
