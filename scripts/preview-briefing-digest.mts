// ============================================================
// Preview the Briefings daily digest (§5 Part C) WITHOUT emailing anyone real.
//
//   npx tsx --env-file=.env.local scripts/preview-briefing-digest.mts [options]
//
//   --day=YYYY-MM-DD      the Dhaka day to preview (default: what tonight's run would target)
//   --recipient=TEXT      only digests whose recipient name/email contains TEXT
//   --fixture             use an obviously fake organisation instead of the database
//   --deliver-to=ADDRESS  actually SEND the (single) selected digest — but to ADDRESS, never to
//                         its real recipient. ADDRESS must be a plus-addressed test account
//                         (jamil.ahmed+something@shikho.com); anything else is refused.
//
// With no --deliver-to nothing is sent at all: it only prints who would get what.
// ============================================================

import { buildDigests, targetDay, type DigestSession, type DigestUser } from '@/lib/briefings/digest'
import { renderDigest } from '@/lib/briefings/digest-email'

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true'] as [string, string] }))
const TEST_ADDRESS = /^jamil\.ahmed\+[a-z0-9._-]+@shikho\.com$/i

const deliverTo = args.get('deliver-to')
if (deliverTo !== undefined && !TEST_ADDRESS.test(deliverTo)) {
  console.error(`Refusing: --deliver-to must be a plus-addressed test account like jamil.ahmed+manager1@shikho.com (got "${deliverTo}").`)
  process.exit(1)
}

// The day, and a "now" that makes the email say "tomorrow" (the evening before).
const ymd = args.get('day')
const day = ymd ? targetDay(new Date(`${ymd}T06:00:00+06:00`)) : targetDay(new Date())
const now = ymd ? new Date(new Date(`${ymd}T00:00:00+06:00`).getTime() - 60 * 60 * 1000) : new Date()

let users: DigestUser[]
let sessions: DigestSession[]

if (args.has('fixture')) {
  const U = (name: string, role: string, o: Partial<DigestUser> = {}): DigestUser => ({ id: name, name, email: `${name.toLowerCase().replace(/\s/g, '.')}@example.invalid`, role, is_active: true, account_status: 'active', team_leader_id: null, manager_id: null, ...o })
  const m = U('Test Manager', 'manager'), a = U('Test Lead Alpha', 'team_lead', { manager_id: m.id }), b = U('Test Lead Beta', 'team_lead', { manager_id: m.id })
  const ag = [U('Test Agent Rahim', 'agent', { team_leader_id: a.id }), U('Test Agent Karim', 'agent', { team_leader_id: a.id }), U('Test Agent Salma', 'agent', { team_leader_id: b.id })]
  users = [m, a, b, ...ag]
  const at = (h: number, mi = 0) => new Date(new Date(`${day.ymd}T00:00:00+06:00`).getTime() + (h * 60 + mi) * 60000).toISOString()
  sessions = [
    { briefingId: 'f1', agentId: ag[0].id, scheduledAt: at(11, 0), conductorName: 'Test Coach', urgent: false },
    { briefingId: 'f2', agentId: ag[1].id, scheduledAt: at(12, 30), conductorName: 'Test Coach', urgent: true },
    { briefingId: 'f3', agentId: ag[2].id, scheduledAt: at(14, 15), conductorName: 'Test Coach 2', urgent: false },
  ]
} else {
  const { getSupabaseAdmin } = await import('@/lib/supabase/server')
  const admin = getSupabaseAdmin()
  const u = await admin.from('users').select('id, name, email, role, is_active, account_status, team_leader_id, manager_id').in('role', ['agent', 'team_lead', 'manager']).limit(5000)
  if (u.error) throw new Error(u.error.message)
  users = u.data as DigestUser[]
  const b = await admin
    .from('briefings')
    .select('id, agent_id, scheduled_at, priority, conductor:users!briefings_conducted_by_fkey(name)')
    .eq('status', 'scheduled').gte('scheduled_at', day.dayStart.toISOString()).lt('scheduled_at', day.dayEnd.toISOString()).limit(5000)
  if (b.error) throw new Error(b.error.message)
  sessions = (b.data as unknown as Array<Record<string, unknown>>).map((r) => ({
    briefingId: r.id as string, agentId: r.agent_id as string, scheduledAt: r.scheduled_at as string, urgent: r.priority === 'critical_same_day',
    conductorName: (r.conductor as { name: string } | null)?.name ?? null,
  }))
}

const needle = args.get('recipient')?.toLowerCase()
const all = buildDigests(users, sessions, day)
const digests = needle ? all.filter((d) => d.recipient.name.toLowerCase().includes(needle) || d.recipient.email.toLowerCase().includes(needle)) : all

console.log(`Day: ${day.dayLabel} (${day.ymd}) — ${sessions.length} scheduled session(s) that day, ${all.length} digest(s) would be sent.`)
if (!args.has('fixture')) {
  const eligible = users.filter((x) => x.is_active && x.account_status === 'active' && (x.role === 'team_lead' || x.role === 'manager')).length
  const profileOnly = users.filter((x) => (x.role === 'team_lead' || x.role === 'manager') && x.account_status !== 'active').length
  console.log(`Eligible recipients (active login): ${eligible}; Team Leads / Managers NOT emailed because they have no login yet: ${profileOnly}.`)
}
for (const d of digests) {
  console.log(`\n• ${d.recipient.name} (${d.recipient.role}) — ${d.total} session(s)`)
  for (const g of d.groups) for (const r of g.rows) console.log(`    ${g.label ? `[${g.label}] ` : ''}${r.time}  ${r.agentName}${r.urgent ? '  (URGENT)' : ''}  — ${r.conductorName ?? 'QA team'}`)
}

if (deliverTo !== undefined) {
  if (digests.length !== 1) {
    console.error(`\n--deliver-to needs exactly ONE selected digest (use --recipient=…); ${digests.length} matched. Nothing sent.`)
    process.exit(1)
  }
  const d = digests[0]
  const mail = renderDigest(d, now)
  const { sendBriefingDigestEmail } = await import('@/lib/users/mailer')
  const banner = `[TEST — this is what ${d.recipient.name} (${d.recipient.role}) would receive; it went ONLY to you]`
  await sendBriefingDigestEmail(deliverTo, `${banner} ${mail.subject}`, mail.html.replace('<body ', `<body data-test="1" `).replace(/(<td align="center">)/, `$1<div style="font:600 12px Arial;color:#E03050;padding:0 0 12px">${banner}</div>`), `${banner}\n\n${mail.text}`)
  console.log(`\nSent ONE test email to ${deliverTo} (not to ${d.recipient.name}).`)
} else {
  console.log('\nNothing was sent (no --deliver-to).')
}
