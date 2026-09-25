// ============================================================
// Run the REAL Briefings digest pipeline once (real database, real SMTP, real
// duplicate-send log) for a chosen Dhaka day — restricted to test accounts.
//
//   npx tsx --env-file=.env.local scripts/run-briefing-digest-once.mts \
//        --day=2026-09-27 --recipients=jamil.ahmed+teamleader1@shikho.com,jamil.ahmed+manager1@shikho.com
//
//   --day=YYYY-MM-DD   the day whose sessions the digest is about (the run pretends it is 23:00 Dhaka the evening before)
//   --recipients=…     REQUIRED. Comma-separated; every one must be a plus-addressed test account
//                      (jamil.ahmed+anything@shikho.com). Only these people can be emailed — anyone else
//                      with sessions that day is skipped and counted.
//   --preview          work it all out and report, send nothing
//
// It can NEVER run in 'live' mode: going live is BRIEFING_DIGEST_MODE=live on the deployed cron,
// deliberately a separate, explicit step.
// ============================================================

import { makeProductionDeps, runBriefingDigest, type DigestMode } from '@/lib/briefings/digest-runner'

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true'] as [string, string] }))
const TEST_ADDRESS = /^jamil\.ahmed\+[a-z0-9._-]+@shikho\.com$/i

const ymd = args.get('day')
if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) { console.error('Give --day=YYYY-MM-DD.'); process.exit(1) }
const recipients = (args.get('recipients') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const preview = args.has('preview')
if (!preview && recipients.length === 0) { console.error('Give --recipients=<plus-addressed test accounts> (or --preview).'); process.exit(1) }
const bad = recipients.filter((r) => !TEST_ADDRESS.test(r))
if (bad.length) { console.error(`Refusing: these are not plus-addressed test accounts: ${bad.join(', ')}`); process.exit(1) }

// 23:00 Dhaka the evening before the chosen day.
const now = new Date(new Date(`${ymd}T00:00:00+06:00`).getTime() - 60 * 60 * 1000)
const mode: DigestMode = preview ? 'preview' : 'test'
const result = await runBriefingDigest(await makeProductionDeps(() => now), { mode, testRecipients: recipients.map((r) => r.toLowerCase()) })
console.log(JSON.stringify(result, null, 2))
