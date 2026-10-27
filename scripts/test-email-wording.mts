// ============================================================
// Regression check for email wording — who the email is ABOUT vs who the
// recipient's REPORTING LINE is. Added 2026-10-27 on Jamil's feedback: the
// Manager's daily digest read "...for the Team Leaders you manage", which
// sounds like the Team Leaders themselves attend the coaching, when the
// sessions are always for the AGENTS under them.
//
// This repo has no committed test framework (no vitest/jest, no test/
// directory) — every prior "N tests" mentioned in CLAUDE.md's history was
// run ad hoc, in-session, and not saved. This is the first persistent,
// re-runnable check for this specific class of bug. Pure assertions
// (Node's built-in assert), no DB, no SMTP — run with:
//   npx tsx --env-file=.env.local scripts/test-email-wording.mts
// ============================================================

import assert from 'node:assert/strict'
import { digestHtml, digestSubject, digestText } from '@/lib/briefings/digest-email'
import type { Digest } from '@/lib/briefings/digest'

let passed = 0
function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ok  ${label}`)
  } catch (err) {
    console.error(`FAIL  ${label}`)
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

const baseRows: Digest['groups'][0]['rows'] = [
  { briefingId: 'b1', agentName: 'Example Agent One', teamLeaderName: 'Example Team Leader', time: '11:15 AM', scheduledAt: '2026-10-28T05:15:00.000Z', conductorName: 'Example Auditor', urgent: false },
]

const teamLeadDigest: Digest = {
  recipient: { id: 'tl1', name: 'Example Team Leader', email: 'tl@example.com', role: 'team_lead' },
  ymd: '2026-10-28', dayLabel: 'Wed 28 Oct', total: 1,
  groups: [{ label: null, rows: baseRows }],
}

const managerDigest: Digest = {
  recipient: { id: 'm1', name: 'Example Manager', email: 'mgr@example.com', role: 'manager' },
  ymd: '2026-10-28', dayLabel: 'Wed 28 Oct', total: 1,
  groups: [{ label: null, rows: baseRows }],
}

const now = new Date('2026-10-27T17:05:00.000Z') // 23:05 Dhaka — the digest cron's own run time

console.log('Briefings daily digest — wording:')

check('Manager HTML says the sessions are for agents (not the Team Leads themselves)', () => {
  const html = digestHtml(managerDigest, now)
  assert.ok(html.includes('for agents from the Team Leaders you manage'), 'expected the new, unambiguous phrase')
})
check('Manager HTML does NOT use the old ambiguous phrase', () => {
  const html = digestHtml(managerDigest, now)
  assert.ok(!html.includes('for the Team Leaders you manage'), 'old phrasing (sessions "for" the Team Leads) must be gone')
})
check('Manager text body matches the HTML wording', () => {
  const text = digestText(managerDigest, now)
  assert.ok(text.includes('for agents from the Team Leaders you manage'))
  assert.ok(!text.includes('for the Team Leaders you manage'))
})

check('Team Lead HTML says the sessions are for agents in their team', () => {
  const html = digestHtml(teamLeadDigest, now)
  assert.ok(html.includes('for agents in your team'), 'expected the new, unambiguous phrase')
})
check('Team Lead HTML does NOT use the old bare "your team" phrase', () => {
  const html = digestHtml(teamLeadDigest, now)
  assert.ok(!html.includes('for your team'), 'old phrasing ("for your team", no mention of agents) must be gone')
})
check('Team Lead text body matches the HTML wording', () => {
  const text = digestText(teamLeadDigest, now)
  assert.ok(text.includes('for agents in your team'))
  assert.ok(!text.includes('for your team'))
})

check('Subject lines still explicitly say "agents" for both roles (unchanged, sanity check)', () => {
  assert.ok(digestSubject(managerDigest, now).includes('agent'))
  assert.ok(digestSubject(teamLeadDigest, now).includes('agents'))
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) {
  console.error('\nSome checks FAILED — see above.')
} else {
  console.log('All email-wording checks passed.')
}
